"""
live_app.py – FastAPI live HLS highlight generation service.
Port: 8500

Workflow:
  POST /api/live/start  → accepts a live HLS URL, creates a session, starts
                          the background polling loop in an asyncio Task.
  DELETE /api/live/{id}/stop → gracefully stops the loop.
  WS  /ws/live/{id}          → real-time JSON progress events.
  GET /api/live              → list all sessions.
  GET /api/live/{id}         → session details.
  GET /api/live/{id}/clips/{file} → serve generated highlight clips.

Run:
    cd backend/hls
    uvicorn live_app:app --reload --port 8500
"""

import asyncio
import gc
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set

import httpx
import torch
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# ── Internal helpers ──────────────────────────────────────────────────────────
from live_session import (
    LiveSession,
    create_session,
    get_session,
    list_sessions,
    push_event,
    update_session,
    delete_session,
)
from utils.converter import concat_segments_to_mp4, cut_clip_from_mp4

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="Live HLS Highlight Generator", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Storage root ──────────────────────────────────────────────────────────────
SESSIONS_DIR = Path(__file__).parent / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

# ── ML model (loaded lazily on first /start call) ─────────────────────────────
_detector = None
_detector_lock = asyncio.Lock()


async def get_detector():
    """Lazy-load the ML models once; safe for concurrent callers."""
    global _detector
    async with _detector_lock:
        if _detector is None:
            from live_models import model_manager, LIVE_CONFIG
            # Load runs in a thread so it doesn't block the event loop
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, model_manager.load)
            _detector = model_manager
    return _detector


# ── WebSocket registry ────────────────────────────────────────────────────────
_ws_clients: Dict[str, List[WebSocket]] = {}


async def _broadcast(session_id: str, message: dict):
    if session_id not in _ws_clients:
        return
    dead = []
    for ws in _ws_clients[session_id]:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _ws_clients[session_id].remove(ws)


# ── Active polling tasks ──────────────────────────────────────────────────────
_active_tasks: Dict[str, asyncio.Task] = {}
_stop_signals: Dict[str, asyncio.Event] = {}


# ── Request / response schemas ────────────────────────────────────────────────
class StartRequest(BaseModel):
    url: str                          # Live .m3u8 URL
    title: str = "Live Match"
    analysis_window_sec: int = 120    # seconds of video to accumulate before analysis
    quality_hint: str = "720p"        # preferred quality from the stream


# ═══════════════════════════════════════════════════════════════════════════════
# HLS PLAYLIST PARSER
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_playlist(text: str, base_url: str) -> dict:
    """
    Parse a media (non-master) HLS playlist.
    Returns:
        {
          "segments": [{"url": str, "duration": float}, …],
          "is_live": bool,     # True when no #EXT-X-ENDLIST
          "sequence": int,
        }
    """
    segments = []
    sequence = 0
    is_live = True
    pending_duration = None

    # Normalise base_url to directory
    if "?" in base_url:
        base_url = base_url.split("?")[0]
    base_dir = base_url.rsplit("/", 1)[0]

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#EXT-X-MEDIA-SEQUENCE:"):
            sequence = int(line.split(":")[1])
        elif line.startswith("#EXT-X-ENDLIST"):
            is_live = False
        elif line.startswith("#EXTINF:"):
            pending_duration = float(line.split(":")[1].rstrip(","))
        elif not line.startswith("#"):
            if pending_duration is not None:
                # Build absolute URL
                if line.startswith("http"):
                    seg_url = line
                else:
                    seg_url = f"{base_dir}/{line}"
                segments.append({
                    "url": seg_url,
                    "duration": pending_duration,
                    "name": line,
                    "sequence": sequence
                })
                sequence += 1
                pending_duration = None

    return {"segments": segments, "is_live": is_live, "sequence": sequence}


async def _resolve_media_url(master_url: str, quality_hint: str = "720p") -> str:
    """
    If `master_url` points to a master playlist, find the best matching rendition.
    Otherwise return it unchanged.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(master_url)
        resp.raise_for_status()
        text = resp.text

    if "#EXT-X-STREAM-INF" not in text:
        return master_url  # Already a media playlist

    # It's a master playlist – pick preferred quality
    base_dir = master_url.rsplit("/", 1)[0]
    best_url = None
    best_bw = 0
    pending_info = None

    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#EXT-X-STREAM-INF:"):
            parts = line.split(":", 1)[1]
            info = {}
            for part in parts.split(","):
                if "=" in part:
                    k, v = part.split("=", 1)
                    info[k] = v.strip()
            pending_info = info
        elif not line.startswith("#") and line:
            if pending_info:
                bw = int(pending_info.get("BANDWIDTH", 0))
                # Prefer url containing the quality hint
                if quality_hint.lower() in line.lower():
                    best_url = line if line.startswith("http") else f"{base_dir}/{line}"
                    break
                if bw > best_bw:
                    best_bw = bw
                    best_url = line if line.startswith("http") else f"{base_dir}/{line}"
            pending_info = None

    return best_url or master_url


# ═══════════════════════════════════════════════════════════════════════════════
# CORE ANALYSIS — runs in a thread pool since it's CPU/GPU intensive
# ═══════════════════════════════════════════════════════════════════════════════

def _analyse_window_sync(
    window_mp4: str,
    window_index: int,
    session_id: str,
    clips_dir: Path,
    session_dir: Path,
    trim_before: float = 10.0,
    trim_after: float = 10.0,
) -> List[dict]:
    """
    Synchronous function (runs in thread executor).
    Runs both vision models + Whisper + fusion on a single analysis-window mp4.
    Returns list of event dicts ready to store in the session.
    """
    from live_models import model_manager, LIVE_CONFIG
    import copy

    cfg = copy.deepcopy(LIVE_CONFIG)
    cfg["video_path"] = window_mp4
    cfg["output_final_json"] = str(session_dir / f"window_{window_index}_result.json")

    detector = model_manager.detector

    print(f"\n[Session {session_id}] ▶ Analysing window {window_index}: {window_mp4}")

    # 1. Vision inference
    try:
        model1_events, model2_events, fps = detector.process_video_with_both_models(window_mp4)
    except Exception as e:
        print(f"[Session {session_id}] ⚠ Vision inference failed: {e}")
        return []

    if not model1_events and not model2_events:
        print(f"[Session {session_id}] No detections in window {window_index}")
        return []

    # 2. Audio transcription
    try:
        transcription = detector.audio_analyzer.transcribe_video(window_mp4)
    except Exception as e:
        print(f"[Session {session_id}] ⚠ Whisper failed: {e}")
        transcription = None

    # 3. Fusion
    try:
        verified = detector.fusion_engine.fuse_detections(
            model1_events, model2_events, transcription, detector.audio_analyzer
        )
    except Exception as e:
        print(f"[Session {session_id}] ⚠ Fusion failed: {e}")
        return []

    # 4. Cut clips
    clips_dir.mkdir(parents=True, exist_ok=True)
    event_counter: dict = {}
    results = []

    for ev in verified:
        etype = ev.get("final_event", "unknown")
        event_counter[etype] = event_counter.get(etype, 0) + 1
        idx = event_counter[etype]
        clip_name = f"w{window_index}_{etype}{idx}.mp4"
        clip_path = clips_dir / clip_name

        ts = ev.get("timestamp", 0.0)
        start = max(0.0, ts - ev.get("custom_trim_before", trim_before))
        end = ts + ev.get("custom_trim_after", trim_after)

        try:
            cut_clip_from_mp4(window_mp4, start, end, str(clip_path))
        except Exception as e:
            print(f"[Session {session_id}] ⚠ Clip cut failed for {clip_name}: {e}")
            continue

        mins = int(ts // 60)
        secs = int(ts % 60)

        record = {
            "window_index": window_index,
            "timestamp": round(ts, 2),
            "time_formatted": f"{mins:02d}:{secs:02d}",
            "event_type": etype,
            "confidence": round(ev.get("final_confidence", 0), 4),
            "clip_name": clip_name,
            "clip_url": f"/api/live/{session_id}/clips/{clip_name}",
            "clip_path": str(clip_path),
            "audio_verified": bool(ev.get("audio_analysis")),
        }
        results.append(record)
        print(f"[Session {session_id}] ✓ Clip ready: {clip_name} ({etype} @ {mins:02d}:{secs:02d})")

    # Memory cleanup
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return results


# ═══════════════════════════════════════════════════════════════════════════════
# POLLING LOOP — Continuous Pipeline (download ∥ analyse)
# ═══════════════════════════════════════════════════════════════════════════════

async def _analyse_worker(
    session_id: str,
    clips_dir: Path,
    session_dir: Path,
    windows_dir: Path,
    analysis_queue: asyncio.Queue,
    all_clips: List[dict],
    window_counter: dict,          # mutable counter {"idx": 0}
):
    """
    Consumer coroutine: pulls chunk info from the queue, concatenates segments
    into an mp4, runs ML analysis in a thread, broadcasts results.
    Runs until it receives a None sentinel from the queue.
    """
    loop = asyncio.get_event_loop()

    while True:
        chunk = await analysis_queue.get()

        # Sentinel: producer is done
        if chunk is None:
            analysis_queue.task_done()
            break

        seg_paths: List[str] = chunk["seg_paths"]
        duration: float = chunk["duration"]

        window_counter["idx"] += 1
        wi = window_counter["idx"]
        window_mp4 = str(windows_dir / f"window_{wi}.mp4")

        print(f"\n[{session_id}] ▶ Analysis worker: starting window {wi} "
              f"({round(duration, 1)}s, {len(seg_paths)} segments, "
              f"{analysis_queue.qsize()} more in queue)")

        await _broadcast(session_id, {
            "type": "window_start",
            "window": wi,
            "duration_sec": round(duration, 1),
            "queued": analysis_queue.qsize(),
        })

        # Concat segments → mp4
        try:
            await loop.run_in_executor(
                None, lambda sp=seg_paths, wp=window_mp4: concat_segments_to_mp4(sp, wp)
            )
        except Exception as e:
            await _broadcast(session_id, {"type": "error", "message": f"Concat failed (w{wi}): {e}"})
            analysis_queue.task_done()
            continue

        # ML analysis
        try:
            clips = await loop.run_in_executor(
                None,
                lambda _wi=wi, _wmp=window_mp4: _analyse_window_sync(
                    _wmp, _wi, session_id, clips_dir, session_dir
                )
            )
        except Exception as e:
            clips = []
            await _broadcast(session_id, {"type": "error", "message": f"Analysis error (w{wi}): {e}"})

        # Persist & broadcast each clip
        for clip in clips:
            all_clips.append(clip)
            await push_event(session_id, clip)
            await _broadcast(session_id, {
                "type": "clip_ready",
                "event": clip["event_type"],
                "clip_url": clip["clip_url"],
                "timestamp": clip["timestamp"],
                "time_formatted": clip["time_formatted"],
                "confidence": clip["confidence"],
                "window": wi,
                "audio_verified": clip["audio_verified"],
            })

        await update_session(session_id, {"windows_analyzed": wi})
        await _broadcast(session_id, {
            "type": "window_done",
            "window": wi,
            "events_found": len(clips),
            "queued": analysis_queue.qsize(),
        })

        analysis_queue.task_done()


async def _poll_and_analyse(
    session_id: str,
    media_url: str,
    analysis_window_sec: int,
    session_dir: Path,
    clips_dir: Path,
    stop_event: asyncio.Event,
):
    """
    Main background coroutine — continuous pipeline.

    Downloading and analysis run concurrently:
      • Download loop: polls HLS, downloads segments, fills buffer.
        When buffer >= analysis_window_sec → pushes chunk to queue, resets buffer.
      • Analysis worker: pulls chunks from queue, concatenates + analyses.
        While the model is busy, new chunks queue up and downloads continue.
      • On stream end, any leftover buffer is pushed as a final chunk.
    """
    POLL_INTERVAL = 3.0

    segments_dir = session_dir / "segments"
    windows_dir = session_dir / "windows"
    segments_dir.mkdir(exist_ok=True)
    windows_dir.mkdir(exist_ok=True)

    downloaded_ids: Set[str] = set()
    buffer: List[dict] = []
    buffered_duration = 0.0
    segments_downloaded = 0
    stream_ended = False

    # Shared mutable state between producer and consumer
    all_clips: List[dict] = []
    window_counter = {"idx": 0}

    # Queue for passing analysis chunks (producer → consumer)
    analysis_queue: asyncio.Queue = asyncio.Queue()

    # Start the analysis worker as a concurrent task
    worker_task = asyncio.create_task(
        _analyse_worker(
            session_id, clips_dir, session_dir, windows_dir,
            analysis_queue, all_clips, window_counter,
        )
    )

    # ── Download / polling loop ───────────────────────────────────────────────
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as http:

        while not stop_event.is_set():
            # ── 1. Fetch playlist ─────────────────────────────────────────
            try:
                resp = await http.get(media_url, headers={"Cache-Control": "no-cache"})
                resp.raise_for_status()
                playlist = _parse_playlist(resp.text, media_url)
            except Exception as e:
                await _broadcast(session_id, {"type": "error", "message": f"Playlist fetch error: {e}"})
                await asyncio.sleep(POLL_INTERVAL)
                continue

            # ── 2. Download new segments ──────────────────────────────────
            new_segs = [s for s in playlist["segments"]
                        if f"{s['sequence']}_{s['url']}" not in downloaded_ids]

            for seg in new_segs:
                seg_url = seg["url"]
                seg_seq = seg["sequence"]
                seg_name = seg["name"].replace("/", "_").replace("\\", "_")
                local_path = segments_dir / f"seg_{segments_downloaded:04d}_{seg_name}"

                try:
                    async with http.stream("GET", seg_url) as r:
                        r.raise_for_status()
                        with open(local_path, "wb") as f:
                            async for chunk in r.aiter_bytes(chunk_size=65536):
                                f.write(chunk)
                except Exception as e:
                    print(f"[{session_id}] ⚠ Failed to download {seg_url}: {e}")
                    continue

                downloaded_ids.add(f"{seg_seq}_{seg_url}")
                segments_downloaded += 1
                buffer.append({"path": str(local_path), "duration": seg["duration"]})
                buffered_duration += seg["duration"]

                await _broadcast(session_id, {
                    "type": "segment",
                    "count": segments_downloaded,
                    "duration": round(buffered_duration, 1),
                    "name": seg_name,
                })

                await update_session(session_id, {
                    "segments_downloaded": segments_downloaded,
                    "buffered_duration": round(buffered_duration, 1),
                    "status": "live",
                })

                # ── 3. Push to analysis queue when buffer is full ─────────
                if buffered_duration >= analysis_window_sec:
                    seg_paths = [s["path"] for s in buffer]

                    await analysis_queue.put({
                        "seg_paths": seg_paths,
                        "duration": buffered_duration,
                    })

                    print(f"[{session_id}] 📦 Queued window chunk "
                          f"({round(buffered_duration, 1)}s, "
                          f"queue depth: {analysis_queue.qsize()})")

                    await _broadcast(session_id, {
                        "type": "chunk_queued",
                        "duration_sec": round(buffered_duration, 1),
                        "queued": analysis_queue.qsize(),
                    })

                    # Reset buffer (no overlap — clean sequential windows)
                    buffer = []
                    buffered_duration = 0.0

            # ── 4. Check for end-of-stream ────────────────────────────────
            if not playlist["is_live"] and not new_segs:
                stream_ended = True

                # Push any leftover buffer as a final chunk (no minimum threshold)
                if buffer:
                    seg_paths = [s["path"] for s in buffer]
                    await analysis_queue.put({
                        "seg_paths": seg_paths,
                        "duration": buffered_duration,
                    })
                    print(f"[{session_id}] 📦 Queued FINAL chunk "
                          f"({round(buffered_duration, 1)}s remaining)")
                    buffer = []
                    buffered_duration = 0.0

                break

            if stop_event.is_set():
                # If stopped manually, still process leftover
                if buffer:
                    seg_paths = [s["path"] for s in buffer]
                    await analysis_queue.put({
                        "seg_paths": seg_paths,
                        "duration": buffered_duration,
                    })
                    buffer = []
                    buffered_duration = 0.0
                break

            await asyncio.sleep(POLL_INTERVAL)

    # ── 5. Signal worker to finish and wait ───────────────────────────────────
    await analysis_queue.put(None)    # sentinel
    await worker_task                 # wait for all queued chunks to finish

    # ── 6. Merge all clips → main_highlights.mp4 ─────────────────────────────
    main_highlights_path = None
    clip_paths = [c["clip_path"] for c in all_clips if os.path.exists(c.get("clip_path", ""))]

    if clip_paths:
        main_highlights_path = str(session_dir / "main_highlights.mp4")
        ts_paths = []
        loop = asyncio.get_event_loop()

        for cp in clip_paths:
            ts_path = cp.replace(".mp4", ".ts")
            try:
                await loop.run_in_executor(None, lambda c=cp, t=ts_path: subprocess.run([
                    "ffmpeg", "-y", "-loglevel", "error",
                    "-i", c, "-c", "copy",
                    "-bsf:v", "h264_mp4toannexb",
                    "-f", "mpegts", t
                ], check=True))
                ts_paths.append(ts_path)
            except Exception as e:
                print(f"[{session_id}] ⚠ TS conversion failed for {cp}: {e}")

        if ts_paths:
            try:
                concat_list = str(session_dir / "merge.txt")
                with open(concat_list, "w") as f:
                    for t in ts_paths:
                        f.write(f"file '{os.path.abspath(t)}'\n")
                await loop.run_in_executor(None, lambda: subprocess.run([
                    "ffmpeg", "-y", "-loglevel", "error",
                    "-f", "concat", "-safe", "0",
                    "-i", concat_list,
                    "-c", "copy", "-bsf:a", "aac_adtstoasc",
                    main_highlights_path
                ], check=True))
                for t in ts_paths:
                    try:
                        os.unlink(t)
                    except Exception:
                        pass
                os.unlink(concat_list)
                print(f"[{session_id}] ✓ main_highlights.mp4 created")
            except Exception as e:
                print(f"[{session_id}] ⚠ Highlights merge failed: {e}")
                main_highlights_path = None

    # ── 7. Finalise session ───────────────────────────────────────────────────
    final_status = "completed" if stream_ended else "stopped"
    await update_session(session_id, {
        "status": final_status,
        "main_highlights": main_highlights_path,
        "windows_analyzed": window_counter["idx"],
        "segments_downloaded": segments_downloaded,
    })

    highlights_url = (
        f"/api/live/{session_id}/highlights"
        if main_highlights_path
        else None
    )
    await _broadcast(session_id, {
        "type": "final_ready",
        "status": final_status,
        "total_events": len(all_clips),
        "total_windows": window_counter["idx"],
        "highlights_url": highlights_url,
    })

    print(f"[{session_id}] Session {final_status}. "
          f"Windows: {window_counter['idx']}, Events: {len(all_clips)}")


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/live/start")
async def start_live_session(body: StartRequest):
    """
    Start a live HLS analysis session.
    Accepts a live or simulated .m3u8 URL and begins the polling loop.
    """
    # Load models (lazy, one-time)
    try:
        await get_detector()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model load failed: {e}")

    # Resolve master → media playlist
    try:
        media_url = await _resolve_media_url(body.url, body.quality_hint)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot fetch HLS URL: {e}")

    session_id = f"live_{uuid.uuid4().hex[:10]}_{int(time.time())}"
    session_dir = SESSIONS_DIR / session_id
    clips_dir = session_dir / "clips"
    session_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(exist_ok=True)

    session = LiveSession(
        session_id=session_id,
        title=body.title,
        hls_url=body.url,
        analysis_window_sec=body.analysis_window_sec,
        status="live",
    )
    await create_session(session)

    stop_event = asyncio.Event()
    _stop_signals[session_id] = stop_event

    task = asyncio.create_task(
        _poll_and_analyse(
            session_id=session_id,
            media_url=media_url,
            analysis_window_sec=body.analysis_window_sec,
            session_dir=session_dir,
            clips_dir=clips_dir,
            stop_event=stop_event,
        )
    )
    _active_tasks[session_id] = task

    return JSONResponse({
        "success": True,
        "session_id": session_id,
        "media_url": media_url,
        "analysis_window_sec": body.analysis_window_sec,
        "status": "live",
        "ws_url": f"ws://localhost:8500/ws/live/{session_id}",
    }, status_code=201)


@app.delete("/api/live/{session_id}/stop")
async def stop_live_session(session_id: str):
    """Stop an active live session gracefully."""
    if session_id not in _stop_signals:
        # May already be finished
        doc = await get_session(session_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Session not found")
        return JSONResponse({"success": True, "status": doc.get("status", "unknown")})

    _stop_signals[session_id].set()
    # Give the task a moment to finalise
    task = _active_tasks.get(session_id)
    if task:
        try:
            await asyncio.wait_for(task, timeout=10.0)
        except asyncio.TimeoutError:
            task.cancel()

    _active_tasks.pop(session_id, None)
    _stop_signals.pop(session_id, None)

    doc = await get_session(session_id)
    return JSONResponse({"success": True, "status": doc.get("status", "stopped") if doc else "stopped"})


@app.get("/api/live")
async def list_live_sessions(limit: int = 50):
    """List all live sessions (most recent first)."""
    docs = await list_sessions(limit=limit)
    return JSONResponse({"success": True, "sessions": docs, "total": len(docs)})


@app.get("/api/live/{session_id}")
async def get_live_session(session_id: str):
    """Get details of a specific live session."""
    doc = await get_session(session_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")
    return JSONResponse({"success": True, "session": doc})


@app.delete("/api/live/{session_id}")
async def delete_live_session(session_id: str):
    """Delete a past session entirely from DB and disk."""
    doc = await get_session(session_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    # If it's active, stop it
    if session_id in _stop_signals:
        _stop_signals[session_id].set()
    
    # Delete from DB
    await delete_session(session_id)
    
    # Delete from disk
    session_dir = SESSIONS_DIR / session_id
    if session_dir.exists():
        try:
            shutil.rmtree(str(session_dir))
        except Exception as e:
            print(f"Failed to delete directory {session_dir}: {e}")
            
    return JSONResponse({"success": True, "message": "Session deleted"})


@app.get("/api/live/{session_id}/clips/{clip_name}")
async def serve_clip(session_id: str, clip_name: str):
    """Serve a generated highlight clip."""
    clip_path = SESSIONS_DIR / session_id / "clips" / clip_name
    if not clip_path.exists():
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(str(clip_path), media_type="video/mp4")


@app.get("/api/live/{session_id}/highlights")
async def serve_highlights(session_id: str):
    """Serve the main highlights reel for a completed session."""
    hl_path = SESSIONS_DIR / session_id / "main_highlights.mp4"
    if not hl_path.exists():
        raise HTTPException(status_code=404, detail="Highlights not ready yet")
    return FileResponse(str(hl_path), media_type="video/mp4")


@app.websocket("/ws/live/{session_id}")
async def ws_live_progress(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time progress events."""
    await websocket.accept()

    if session_id not in _ws_clients:
        _ws_clients[session_id] = []
    _ws_clients[session_id].append(websocket)

    # Send current session state immediately on connect
    doc = await get_session(session_id)
    if doc:
        await websocket.send_json({"type": "state", "session": doc})

    try:
        while True:
            # Keep-alive ping every 20 s
            await asyncio.sleep(20)
            try:
                await websocket.send_json({"type": "ping"})
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    finally:
        if session_id in _ws_clients:
            try:
                _ws_clients[session_id].remove(websocket)
            except ValueError:
                pass


@app.get("/api/live/{session_id}/events")
async def get_session_events(session_id: str):
    """Return all detected events for a session (without the full session doc)."""
    doc = await get_session(session_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")
    return JSONResponse({
        "success": True,
        "session_id": session_id,
        "status": doc.get("status"),
        "events": doc.get("events", []),
        "total": len(doc.get("events", [])),
    })


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "active_sessions": len(_active_tasks),
        "models_loaded": _detector is not None,
    }


# ── Startup: pre-load models so first request is instant ─────────────────────
@app.on_event("startup")
async def startup_event():
    print("[live_app] Starting up — pre-loading ML models…")
    try:
        await get_detector()
        print("[live_app] ✓ Models ready")
    except Exception as e:
        print(f"[live_app] ⚠ Model pre-load failed (will retry on first request): {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8500)
