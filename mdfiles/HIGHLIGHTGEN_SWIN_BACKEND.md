# HighlightGen (Swin) Backend — `generator/app2.py`

This document summarizes the `generator/app2.py` FastAPI service (the Swin-based highlight generation backend). It documents configuration, core classes and algorithms, API endpoints, database interactions, file and JSON outputs, and run instructions. Use this as the canonical developer reference for the generator service.

Location: `backend/generator/app2.py`

---

## High-level overview

- Purpose: long-form video processing pipeline that runs two vision models (an enhanced swin transformer and a video swin transformer), an audio transcription / commentary analyzer (Whisper + fuzzy matching), and a multimodal fusion engine to produce verified highlight events and clips.
- Designed for long videos: supports chunked processing for memory control, checkpointing, and progress updates via WebSocket.
- Integrates with MongoDB to store match metadata and links to produced media.
- Produces JSON outputs: raw detections, final `verified_events` JSON (strict audio verification mode), intermediate checkpoints, and media clip files stored under `media/`.

---

## Configuration & globals

- `CONFIG` (top-level dict): many runtime options including model paths, frame sizes, timing windows, thresholds and booleans that configure fusion behavior. Important keys:
  - `model1_path`, `model2_path`: paths to model checkpoints
  - `num_frames`, `img_size`, `batch_size`, `frame_skip`
  - `whisper_model`: Whisper model name (e.g., `base`)
  - `audio_match_window`, `min_keyword_matches`, `min_high_confidence_matches`
  - `confidence_threshold`, `high_confidence_bypass`, `min_event_gap`
  - `trim_window_before`, `trim_window_after` for clip trimming
  - `device`: `'cuda'` if available else `'cpu'`

- `BASE_MEDIA_DIR` (Path("media")) — base directory for storing uploaded media, generated clips and checkpoints.
- MongoDB connection: `AsyncIOMotorClient(MONGODB_URL)` — database `football_highlights`, collection `matches`.

---

## Important constants and dictionaries

- `SEQUENCE_RULES` — per-event allowed transitions, causality and optional `time_constraints` (e.g., `foul` can cause `penalty`, `freekick`). Used by `FootballSequenceValidator`.
- `COMMENTARY_DICT` — phrase lists (high/medium/low confidence) for each event type (goal, penalty, freekick, corner, foul) used by the audio analyzer to score segments.
- `REPLAY_KEYWORDS` — phrases indicating replays ("replay", "slow motion", etc.).
- `EVENT_CONFIDENCE_RULES` — per-event thresholds and whether audio verification is required.

---

## Core classes and components

Below are the main classes and their responsibilities (as implemented in `app2.py`).

1) ProgressTracker
- Tracks per-match progress state and open WebSocket connections.
- Methods:
  - `update(match_id, status, progress, message)` — store current progress in `self.progress`.
  - `broadcast(match_id)` — asynchronously send current progress to all connected websockets for `match_id`.

2) ChunkedVideoProcessor
- Handles splitting very long videos into manageable time chunks and processing individual chunks.
- Methods:
  - `get_video_info(video_path)` — returns fps, duration, frame count and resolution without loading the whole video.
  - `calculate_chunks(duration)` — compute chunk boundaries given `chunk_duration_minutes`.
  - `process_chunk(video_path, start_time, end_time, chunk_idx, total_chunks, detector)` — loads frames for the time range, buffers frames, runs detector inference per chunk and returns model event lists for the chunk. Performs memory monitoring and cleanup and emits progress updates.
  - `merge_chunk_events(all_events, overlap_time)` — merge events found across chunks while deduplicating near chunk boundaries.

3) FootballSequenceValidator
- Validates/prunes event sequences according to `SEQUENCE_RULES` and optional audio verification for consecutive events. (Note: the generator has variants where sequence validation may be enabled or disabled depending on mode.)

4) Model classes
- `ContextAwareTemporalModule` — convolutional pyramid temporal module used to aggregate frame-level features.
- `EnhancedSwinSmallTransformer` — enhanced swin-based temporal architecture that aggregates frame features with LSTM and attention and outputs class logits.
- `VideoSwinTransformer` — a simpler video swin temporal classifier variant.

5) RobustCommentaryAnalyzer
- Uses Whisper to transcribe audio and then performs fuzzy matching of commentary phrases against `COMMENTARY_DICT` within a temporal window around an event timestamp.
- Key methods:
  - `transcribe_video(video_path)` — returns transcription dict with `segments` containing `start`, `end`, `text`.
  - `analyze_audio_for_event(timestamp, transcription, window)` — finds relevant transcription segments, scores phrases, and returns audio evidence summary including `event_type`, `audio_confidence`, match counts by confidence level, `best_matches` and replay detection.
  - `_detect_replay(segments)` — looks for replay keywords in nearby segments.

6) MultimodalFusionEngine
- Merges visual detections from model1 and model2, checks video confidence thresholds, requests audio verification via `RobustCommentaryAnalyzer` (if transcription available), protects certain transitions (foul→penalty), optionally adds audio-only events, tags replays, filters duplicates and prevents trim overlaps.
- Important behaviors:
  - Ultra-high confidence bypass: events with video confidence >= per-event `ultra_high_threshold` may be added without audio.
  - Strict audio mode: defaults in generator enforce stricter audio verification for adding or overriding events.
  - Audio-only additions: `audio_can_add_events` allows adding events found in audio even if vision missed them (strict requirements apply).

7) RobustMultiModalDetector
- Orchestrates loading models, running inference across frames, saving raw detections, and obtaining transcription & fusion results.
- Key methods:
  - `load_frames_generator(video_path)` — yields frames with index using `frame_skip`.
  - `preprocess_batch(frames)` — convert frames to normalized tensors.
  - `process_video_with_both_models(video_path)` — runs inference across entire video, orchestrates chunking behavior or chunked processing via `ChunkedVideoProcessor`.
  - `_process_frame_chunk(frames, frame_indices, fps)` — runs model inference on a chunk of frames and returns model-specific events.
  - `save_raw_detections(...)` and `save_final_results(...)` — write raw and final JSON outputs. Final output includes `fusion_settings`, `summary`, `verified_events` and `event_statistics`.

---

## File outputs and JSON shapes

1) Raw detections JSON (saved by `save_raw_detections`)

{
  "video_info": { "path": ..., "fps": 25.0 },
  "model1_detections": { "total": N, "events": [ { ... }, ... ] },
  "model2_detections": { "total": M, "events": [ { ... }, ... ] },
  "event_counts": { "model1": {"goal": 3, ...}, "model2": {...} }
}

2) Final verified events JSON (saved by `save_final_results`) — important fields:

{
  "video_info": {...},
  "fusion_settings": {...},
  "summary": { "total_verified_events": number, "audio_corrected": number, ... },
  "verified_events": [
    {
      "id": number,
      "event_type": "goal",
      "timestamp": float (seconds),
      "time_range": "mm:ss - mm:ss",
      "duration_seconds": float,
      "frame_count": int,
      "commentary_count": int,
      "key_frame": "media/...jpg",
      "clip_path": "media/...mp4",
      "is_replay": bool,
      "audio": { audio verification fields },
      "context_frames": [ { "file": "...", "global_timestamp": "...", "rag_description": "...", "active_events": [...] }, ... ]
    },
    ...
  ],
  "event_statistics": { "goal": 3, "foul": 5, ... }
}

Notes: `fusion_settings` includes `audio_verification` mode (generator's default is `STRICT_REQUIRED`) and trimming windows.

3) Checkpoints
- Checkpoint files are written to `media/<match_id>/checkpoint_<chunk_idx>.json` during chunked processing: they record chunk progress and intermediate counts.

---

## MongoDB schema (document stored in `matches` collection)

Top-level fields used by the generator and helper `match_helper`:

{
  "_id": ObjectId,
  "match_id": string (UUID or generated id),
  "title": string,
  "date": string,
  "description": string,
  "video_path": str (relative path under `media/<match_id>/...`),
  "poster_path": str,
  "status": 'uploaded'|'processing'|'completed'|'failed',
  "main_highlights": optional path to highlights video,
  "event_clips": { <event_type>: [paths...] },
  "analysis_data": { event_statistics, verified_events, etc. },
  "created_at": datetime,
  "updated_at": datetime
}

The API `match_helper` converts ObjectId and datetimes to serializable strings for JSON responses.

---

## API endpoints (summary + usage)

All endpoints are under the generator service (default port `9000`).

1) POST /api/matches/upload
- Purpose: Upload a new match and associated metadata.
- Request (multipart/form-data):
  - `title` (string), `date` (string), `description` (optional string)
  - `video` (file), `poster` (optional file)
- Behavior:
  - Save files under `media/<match_id>/` (with generated `match_id`).
  - Insert a DB document in `matches` with `status: 'uploaded'` and file paths.
  - Returns created match document (via `match_helper`).

2) WebSocket: /ws/progress/{match_id}
- Purpose: Clients can connect to receive real-time progress updates. The server stores websockets per `match_id` in `progress_tracker.websockets` and `progress_tracker.broadcast()` sends updates.

3) POST /api/matches/{match_id}/analyze
- Purpose: Trigger AI analysis for a specific match (optimized for chunked processing).
- Behavior:
  - Validate match exists and files present.
  - Spawn processing (chunked or non-chunked) using `RobustMultiModalDetector.process_video_chunked`.
  - Update DB status to `processing` and write progress updates via `progress_tracker`.
  - On completion, save final outputs, upload/attach clips to DB doc, and set `status` to `completed`.
  - Returns success JSON and possibly immediate partial evidence.

4) GET /api/matches/{match_id}/progress
- Returns latest progress (from `progress_tracker.progress`) or DB fallback if not found.

5) GET /api/matches
- Returns paginated list of match documents, supports `status` filter.

6) GET /api/matches/{match_id}
- Returns a single match document with fields from DB (including `analysis_data`, `event_clips`, `main_highlights`).

7) GET /api/media/{match_id}/{file_path:path}
- Serves media files (video, images) from `media/<match_id>/...`. Useful for frontend to show images and play clips.

8) DELETE /api/matches/{match_id}
- Deletes a match entry and associated files from disk and database.

---

## WebSocket progress contract

- Clients connect to `ws://<host>:9000/ws/progress/{match_id}`.
- Server sends JSON messages of shape:

{
  "status": "starting" | "processing" | "completed" | "failed",
  "progress": number (0-100),
  "message": string,
  "timestamp": "ISO8601"
}

Clients should handle disconnections (server closes socket when done) and may poll `/api/matches/{match_id}/progress` as a fallback.

---

## Chunking & long video strategy

- `ChunkedVideoProcessor` splits videos into 50-minute chunks (configurable) and processes each chunk independently.
- It ensures memory stays bounded, cleans CUDA cache after processing a chunk, and checkpoint saves progress to avoid reprocessing from scratch.
- After all chunks processed, `merge_chunk_events()` deduplicates events near chunk boundaries (using an `overlap_time` threshold).

---

## Running the service

Preconditions:
- Python environment with packages used by `app2.py`: torch, timm, whisper, fastapi, uvicorn, motor, opencv-python (cv2), numpy, rapidfuzz, psutil, etc.
- MongoDB running and accessible at `MONGODB_URL` in the file (default `mongodb://localhost:27017`).
- Model checkpoint files available at `CONFIG['model1_path']` and `CONFIG['model2_path']` (or update `CONFIG`).

Run development server (PowerShell example):

```powershell
# from repository root
python -m uvicorn backend.generator.app2:app --host 0.0.0.0 --port 9000 --reload
```

Upload a match (example curl, replace paths as needed):

```powershell
curl -X POST "http://localhost:9000/api/matches/upload" `
  -F "title=My Match" `
  -F "date=2025-10-13" `
  -F "description=Local derby" `
  -F "video=@C:/path/to/match.mp4" `
  -F "poster=@C:/path/to/poster.jpg"
```

Trigger analysis:

```powershell
curl -X POST "http://localhost:9000/api/matches/<match_id>/analyze"
```

Connect to WebSocket (JS example):

```js
const ws = new WebSocket('ws://localhost:9000/ws/progress/<match_id>');
ws.onmessage = (ev) => console.log('progress', JSON.parse(ev.data));
```

---

## Developer notes & recommendations

- Environment variables: replace hard-coded `MONGODB_URL`, `BASE_MEDIA_DIR`, `model paths` and `whisper_model` with env-configured values.
- Provide an example `example_verified_events.json` (small sample) so frontend developers can mock responses without running heavy models.
- Export `COMMENTARY_DICT` as `football_commentary.json` so the analyzer can be seeded without importing the Python file; also useful for editing and versioning commentary phrases.
- Add JSON Schemas for the final verified events and raw detection outputs to make integration with RAG/other systems simpler.
- Consider an optional lightweight analysis mode for CI/local dev that skips model loading (returns mocks) to speed frontend development.

---

If you want, I can now:
- Generate a `backend/generator/PROCESSED_JSON_SCHEMA.json` draft for the final and raw outputs.
- Create `backend/generator/football_commentary.json` by serializing `COMMENTARY_DICT` from `app2.py`.
- Replace hard-coded config values with environment variable lookups and add a `.env.example`.

Which should I do next?
