# VideoLLM Backend Report

This document describes the backend `app.py` (FastAPI) and related processing artifacts used by the VideoLLM backend in this repository. It focuses on how the project processes segmented batch JSON files (`batch1.json`...`batch9.json`), generates `processed_batch*.json`, the purpose and expected structure of `football_commentary.json`, and the `global_video_index.json` produced by the segment processor. Use this as a reference for generating reports, writing docs, or integrating RAG (retrieval-augmented generation) systems.

Files referenced in this report:
- `backend/app.py` (main FastAPI service and multimodal detector) — key classes: `FootballSequenceValidator`, `ContextAwareTemporalModule`, `EnhancedSwinSmallTransformer`, `VideoSwinTransformer`, `RobustCommentaryAnalyzer`, `MultimodalFusionEngine`, `RobustMultiModalDetector`.
- `backend/process_video_segments.py` (helper script that converts segment JSONs to processed outputs and builds `global_video_index.json`) — included as attachment and used as authoritative reference for processed JSON shapes.
- `backend/batch1.json` ... `backend/batch9.json` (original per-segment frame-level JSON files)
- `backend/processed_batch1.json` ... `backend/processed_batch9.json` (outputs created by `process_video_segments.py`)
- `backend/global_video_index.json` (global index used for RAG retrieval)
- `backend/football_commentary.json` (commentary dictionary / corpus referenced by audio analyzer)

---

## High-level pipeline (what the backend does)

1. Video is uploaded (FastAPI endpoint `/analyze` in `app.py`) or processed offline.
2. Video frame extraction is performed and frames are saved into batch JSON files (`batch1.json` ... `batch9.json`) — these are arrays of frame objects produced by the detector pipeline.
3. `process_video_segments.py` is used to convert the raw batch JSONs into `processed_batchN.json` files with global timestamps and RAG-optimized descriptions; it also builds `global_video_index.json` and `combined_video_data.json`.
4. The multimodal pipeline in `app.py` runs two visual models and an audio analyzer (Whisper-based) to detect events, merge detections, perform audio verification, and produce `verified_events` output JSON.
5. The UI (frontend) consumes the verified events and media URLs via endpoints such as `GET /api/matches`, `GET /api/matches/{id}`, and media endpoints under `/api/media/...`.

---

## `process_video_segments.py` — output schemas and behavior

This script is the canonical reference for how per-segment batch JSONs are transformed for RAG and downstream UI usage. Key behaviors:

- Adds global timestamps: for each frame in a segment, it calculates `global_timestamp` by adding the local `frame.timestamp` within that segment to the segment start time (mapping provided in `segment_mapping`).
- Updates frame `file` paths into local `batch{segment_id}/{filename}` structure for easier local resolution.
- Builds a concise `rag_description` optimized for retrieval by extracting a scene description and concatenating an `Events: ...` summary.
- Produces per-segment processed files named `processed_{batch_file}` (e.g., `processed_batch1.json`) and writes a combined index `global_video_index.json` and `combined_video_data.json`.

### Schema: processed_batchN.json (per `process_batch_file`)

Each `processed_batchN.json` has the following structure:

{
  "segment_info": {
    "segment_id": number,
    "global_start_time": "HH:MM:SS",
    "global_end_time": "HH:MM:SS",
    "duration": "MM:SS",
    "total_frames": number
  },
  "frames": [
    {
      "frame_number": number,
      "segment_id": number,
      "local_timestamp": "MM:SS[.mmm]",
      "global_timestamp": "HH:MM:SS.mmm",
      "file": "batch<segment_id>/frame_filename.jpg",
      "rag_description": "Concise description optimized for RAG",
      "active_events": ["goal", "foul", ...],
      "events": { <original per-event boolean flags> },
      "full_description": "Original verbose description (optional)"
    },
    ...
  ]
}

Notes:
- `rag_description` is created by `create_rag_optimized_description` and typically contains a concise scene description followed by an `Events:` summary.
- `active_events` is an array derived from the boolean `events` mapping in the original per-frame JSON and is intended for fast lookups in a RAG index.

### Schema: global_video_index.json (per `create_global_index`)

This file provides a global index across all segments and frames and supports two primary lookup styles: `event_index` and `timestamp_index`.

{
  "total_segments": number,
  "total_duration": "HH:MM:SS",
  "event_index": {
    "goal": [ { "global_timestamp": "HH:MM:SS.mmm", "segment_id": number, "frame_number": number, "file": "..." }, ... ],
    "foul": [ ... ],
    ...
  },
  "timestamp_index": [
    { "global_timestamp": "HH:MM:SS.mmm", "segment_id": number, "frame_number": number, "file": "...", "active_events": [ ... ] },
    ...
  ],
  "frame_count_by_segment": { "1": number, "2": number, ... }
}

Notes:
- `event_index` maps event names to arrays of frame references (suitable for RAG retrieval by event).
- `timestamp_index` is optimized for time-range queries and can be scanned or binary-searched depending on your retrieval needs.

### Schema: combined_video_data.json

Contains `metadata`, `segments` (array of processed segment objects), and `global_index` (the same structure as `global_video_index.json`). Useful for exporting or archiving the entire processed dataset.

---

## `football_commentary.json` (purpose and expected content)

The repository includes a `football_commentary.json` referenced by the audio analyzer logic in `app.py` and used to match speech to event types. While the full file content isn't included here, expectations are:

- Structure: likely a mapping of event types (e.g., `goal`, `penalty`, `freekick`, `corner`, `foul`) to arrays of phrases grouped by confidence levels (high, medium, low). The `app.py` attachment defines a `COMMENTARY_DICT` object in Python which shows the exact form expected.
- Example (from `app.py`):
  - `COMMENTARY_DICT['goal']['high_confidence']` contains phrases like "goal!", "he scores!", "back of the net!".
  - Each event has `high_confidence`, `medium_confidence`, and `low_confidence` lists.
- Use: `RobustCommentaryAnalyzer` scans transcription segments, counts fuzzy matches to these phrases, and produces `audio_confidence`, `total_matches`, `high_confidence_matches`, etc.

If you need a static JSON file to seed the analyzer in other environments, serialize the `COMMENTARY_DICT` structure used in `app.py` into `football_commentary.json` with the same keys and lists.

---

## `app.py` — classes and responsibilities (summary)

The main `app.py` is a large script; the provided attachment shows the major components. Here is a summarized breakdown of the most important classes and functions relevant to the processed JSON artifacts and detection pipeline:

- `FootballSequenceValidator`
  - Purpose: Validate and prune event sequences according to `SEQUENCE_RULES`. In the provided `app.py` variant, sequence validation is supported but in later sections the fusion engine removed strict sequence validation. Still, the class documents the intended rules for allowable transitions and special handling for causality (e.g., foul -> penalty).
  - Inputs: event list, transcription, audio_analyzer
  - Outputs: validated events list (pruned/adjusted)

- `ContextAwareTemporalModule`, `EnhancedSwinSmallTransformer`, `VideoSwinTransformer`
  - Purpose: Model architectures for extracting features across frames and classifying temporal sequences of frames into event predictions.
  - Role: Extract visual detections that get merged and verified by fusion engine.

- `RobustCommentaryAnalyzer`
  - Purpose: Transcribe video audio (Whisper) and score segments against the commentary dictionary to produce audio-based event support.
  - Important methods:
    - `transcribe_video(video_path)` — returns transcription with `segments` (standard Whisper format: start, end, text)
    - `analyze_audio_for_event(timestamp, transcription, window)` — scans transcription segments within +/- window seconds and computes scores for each event type, returns object with `event_type`, `audio_confidence`, `total_matches`, `high_confidence_matches`, `matched_segments`, `best_matches`, and `is_replay`.
    - `_detect_replay(segments)` — recognizes commentary phrases indicating replays (e.g., "replay", "slow motion") and surfaces a replay confidence.

- `MultimodalFusionEngine`
  - Purpose: Merge detections from both visual models, perform event-level verification (audio-based), tag replays, correct or override labels when confident audio evidence exists, and filter duplicates.
  - Important methods:
    - `fuse_detections(model1_events, model2_events, transcription, audio_analyzer)` — central fusion flow producing `verified_events`.
    - `_merge_model_detections(...)` — merges model events within a `time_threshold` into merged candidate events.
    - `_find_audio_only_events(...)` — can add audio-only events when enabled and if they meet strict criteria.
    - `_filter_replays_and_select_primary(...)` — removes weaker duplicates and replays.
    - `_prevent_trim_overlaps(...)` — adjusts trimming windows to avoid overlaps between adjacent clips.

- `RobustMultiModalDetector`
  - Purpose: Top-level detector orchestrating frame extraction, running both models, saving raw detections, initializing `RobustCommentaryAnalyzer` and `MultimodalFusionEngine`, and saving final results.
  - Important flows:
    - `process_video_with_both_models(video_path)` — processes frames in batches and returns `model1_events`, `model2_events`, and `fps`.
    - `save_raw_detections(...)` and `save_final_results(...)` — write outputs to disk; `save_final_results` writes the `CONFIG['output_final_json']` file which is the final verified events JSON.

---

## Expected shapes for model detections and final verified events

While the exact full schema is distributed across many functions, typical event objects used by the fusion engine and final outputs include fields like:

{
  "timestamp": float,           # event timestamp in seconds
  "final_event": "goal",      # normalized event label
  "confidence": float,         # model-level confidence (0-1)
  "frame_index": int,          # representative frame index
  "key_frame": "path/to/image.jpg", # path to a key frame image
  "clip_path": "path/to/clip.mp4",  # optional clip url or path
  "is_replay": bool,           # flagged replay
  "audio": { ... }             # audio verification result if present
}

Final `verified_events` returned by `fuse_detections` are an array of similar objects, with extra metadata such as `time_range`, `duration_seconds`, `frame_count`, `commentary_count`, and `context_frames` (frame entries with `file`, `global_timestamp`, `rag_description`, `active_events`).

---

## How the frontend / RAG expects to use these artifacts

- `processed_batch*.json`: used to show frame thumbnails, to map frames to global timestamps, and to populate RAG retrieval documents (via `rag_description`).
- `global_video_index.json`: used for fast retrieval by event or by time-range (used by `app/chat` / `AnalysisDisplay` to resolve frames and clips when the user asks queries like "show me all goals").
- `verified_events` output: used to populate the match timeline, highlight clips, and to power the chat analysis responses.

---

## Running and reproducing processed files

Regenerate processed outputs using `process_video_segments.py` (PowerShell example):

```powershell
# From repository root (Windows PowerShell)
python .\backend\process_video_segments.py
```

This will read `batch1.json` ... `batch9.json` from the same directory (script uses `workspace_path`), produce `processed_batch1.json` ... `processed_batch9.json`, `global_video_index.json`, and `combined_video_data.json`.

Start the FastAPI server locally (if you want to test `/analyze`):

```powershell
# From repository root
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
```

Notes:
- `python` must point to an environment with required dependencies (torch, timm, whisper, fastapi, uvicorn, rapidfuzz, etc.). The `app.py` config prints which models it expects — validate paths in `CONFIG` before running.

---

## Recommendations & next steps

- Replace hard-coded `workspace_path` and `localhost` addresses with environment-driven variables (e.g., `NEXT_PUBLIC_API_BASE_URL` for frontend; `VIDEO_WORKSPACE` for processors) to ease deployments.
- Add a JSON Schema document for `processed_batch*.json` and `global_video_index.json` so external tools (RAG indexers, search engines) can validate inputs.
- Consider sanitizing or normalizing phrases in `football_commentary.json` (lowercase, remove punctuation) to speed fuzzy matching; document the fuzz matching parameters used by `RobustCommentaryAnalyzer`.
- Add small examples of `verified_events` JSON in the repo (e.g., `example_verified_events.json`) to allow frontend developers to mock the backend without running heavy models.

---

If you'd like, I can:
- Generate `backend/PROCESSED_JSON_SCHEMA.md` with JSON Schema drafts for `processed_batchN.json` and `global_video_index.json`.
- Create a small script to convert `COMMENTARY_DICT` in `app.py` into `football_commentary.json` and commit it.
- Replace hard-coded URLs in the frontend and backend with environment variables and prepare a patch.

Tell me which follow-up you'd prefer and I will proceed.
