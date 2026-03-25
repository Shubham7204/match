"""
live_simulator.py – Simulates a live HLS stream using existing pre-segmented VOD content.

This FastAPI app on port 8600 serves the existing VOD .ts segments AS IF they are a
live stream by:
  1. Maintaining a "current sequence number" that advances every SEGMENT_INTERVAL seconds
  2. Returning a live-style .m3u8 playlist (no #EXT-X-PLAYLIST-TYPE:VOD, sliding window)
  3. Adding #EXT-X-ENDLIST once all segments have been served

Usage:
    cd backend/hls
    uvicorn live_simulator:app --port 8600

Simulated stream URL (give this to the live_app):
    http://localhost:8600/live/try/720p/playlist.m3u8
"""

import asyncio
import time
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, FileResponse
from typing import Dict

app = FastAPI(title="HLS Live Simulator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Configuration ────────────────────────────────────────────────────────────
# Path to the existing 720p VOD segments (relative to this file's directory)
HLS_ROOT = Path(__file__).parent / "hls"

# How many seconds of REAL time between each simulated segment release.
# Each segment is ~4 s of video. Set to 4.0 for real-time, smaller to speed up testing.
SEGMENT_INTERVAL = 4.0  # seconds real-time per segment release

# Sliding window: how many segments appear at a time in the live playlist
WINDOW_SIZE = 10

# ── State (per "stream") ─────────────────────────────────────────────────────
class LiveStream:
    def __init__(self, segment_dir: Path, target_duration: float):
        self.segment_dir = segment_dir
        self.target_duration = target_duration           # e.g. 4.8 s average
        # Build ordered list of (filename, duration) from local VOD m3u8
        self.all_segments = self._parse_vod_segments()
        self.total = len(self.all_segments)
        self.start_time = time.time()
        self.done = False

    def _parse_vod_segments(self):
        """Read the local VOD index.m3u8 to extract segment names + durations."""
        m3u8_path = self.segment_dir / "index.m3u8"
        segments = []
        pending_duration = None
        with open(m3u8_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("#EXTINF:"):
                    pending_duration = float(line.split(":")[1].rstrip(","))
                elif line and not line.startswith("#"):
                    if pending_duration is not None:
                        segments.append((line, pending_duration))
                        pending_duration = None
        return segments

    def current_released_count(self) -> int:
        """How many segments have been 'released' so far (simulates live feed)."""
        elapsed = time.time() - self.start_time
        count = int(elapsed / SEGMENT_INTERVAL) + 1   # +1: first segment instant
        count = min(count, self.total)
        if count == self.total:
            self.done = True
        return count

    def build_playlist(self) -> str:
        released = self.current_released_count()
        window_start = max(0, released - WINDOW_SIZE)
        window_segs = self.all_segments[window_start:released]

        lines = [
            "#EXTM3U",
            "#EXT-X-VERSION:3",
            f"#EXT-X-TARGETDURATION:{int(self.target_duration) + 1}",
            f"#EXT-X-MEDIA-SEQUENCE:{window_start}",
        ]
        for seg_name, duration in window_segs:
            lines.append(f"#EXTINF:{duration:.6f},")
            lines.append(seg_name)

        if self.done:
            lines.append("#EXT-X-ENDLIST")

        return "\n".join(lines) + "\n"



# Registry of active simulated streams
_streams: Dict[str, LiveStream] = {}


def _get_or_create_stream(video_name: str, quality: str) -> LiveStream:
    key = f"{video_name}/{quality}"
    if key not in _streams:
        seg_dir = HLS_ROOT / video_name / quality
        if not seg_dir.exists():
            raise FileNotFoundError(f"Segment directory not found: {seg_dir}")
        # Detect average segment duration from VOD m3u8
        stream = LiveStream(seg_dir, target_duration=5.0)
        _streams[key] = stream
        print(f"[Simulator] Started live simulation for {key} ({stream.total} segments)")
    return _streams[key]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/live/{video_name}/{quality}/playlist.m3u8", response_class=PlainTextResponse)
async def get_live_playlist(video_name: str, quality: str):
    """Return a sliding-window live HLS playlist."""
    try:
        stream = _get_or_create_stream(video_name, quality)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    playlist = stream.build_playlist()
    return PlainTextResponse(
        content=playlist,
        media_type="application/vnd.apple.mpegurl",
        headers={
            "Cache-Control": "no-cache, no-store",
            "Access-Control-Allow-Origin": "*",
        }
    )


@app.get("/live/{video_name}/{quality}/{segment_name}")
async def serve_segment(video_name: str, quality: str, segment_name: str):
    """Serve a .ts segment file."""
    seg_path = HLS_ROOT / video_name / quality / segment_name
    if not seg_path.exists():
        raise HTTPException(status_code=404, detail=f"Segment not found: {segment_name}")
    return FileResponse(str(seg_path), media_type="video/mp2t")


@app.get("/live/{video_name}/master.m3u8", response_class=PlainTextResponse)
async def get_master_playlist(video_name: str):
    """Return the master multi-bitrate playlist (points to live sub-playlists)."""
    master_vod = HLS_ROOT / video_name / "master.m3u8"
    if not master_vod.exists():
        raise HTTPException(status_code=404, detail="master.m3u8 not found")

    # Rewrite variant playlist URLs to point to our live endpoints
    lines = ["#EXTM3U"]
    quality = None
    bandwidth = None
    resolution = None

    with open(master_vod) as f:
        for line in f:
            line = line.strip()
            if line.startswith("#EXT-X-STREAM-INF:"):
                # Extract bandwidth and resolution
                parts = line.split(":", 1)[1]
                info = {}
                for part in parts.split(","):
                    if "=" in part:
                        k, v = part.split("=", 1)
                        info[k] = v
                bandwidth = info.get("BANDWIDTH", "0")
                resolution = info.get("RESOLUTION", "")
                lines.append(f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={resolution}")
            elif line and not line.startswith("#"):
                # e.g. "720p/index.m3u8" → extract quality name
                quality = line.split("/")[0]
                lines.append(f"{quality}/playlist.m3u8")
            else:
                if line:
                    lines.append(line)

    return PlainTextResponse(
        content="\n".join(lines) + "\n",
        media_type="application/vnd.apple.mpegurl"
    )


@app.post("/live/{video_name}/reset")
async def reset_stream(video_name: str):
    """Reset all quality streams for a video (restart simulation from beginning)."""
    removed = []
    for key in list(_streams.keys()):
        if key.startswith(f"{video_name}/"):
            del _streams[key]
            removed.append(key)
    return {"reset": removed}


@app.get("/status")
async def status():
    return {
        "active_streams": list(_streams.keys()),
        "streams": {
            k: {
                "total_segments": v.total,
                "released": v.current_released_count(),
                "done": v.done,
                "elapsed_sec": round(time.time() - v.start_time, 1)
            }
            for k, v in _streams.items()
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8600)
