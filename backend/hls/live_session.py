"""
live_session.py – MongoDB helpers and dataclass for a live HLS analysis session.
"""
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional, List, Dict, Any
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
_client = AsyncIOMotorClient(MONGODB_URL)
_db = _client["football_highlights"]
live_col = _db["live_sessions"]


@dataclass
class LiveEvent:
    timestamp: float
    event_type: str
    confidence: float
    clip_url: str          # relative URL served via /api/live/{id}/clips/...
    clip_path: str         # absolute filesystem path
    time_formatted: str
    window_index: int
    audio_verified: bool


@dataclass
class LiveSession:
    session_id: str
    title: str
    hls_url: str
    analysis_window_sec: int
    status: str                         # "live" | "stopped" | "completed" | "failed"
    segments_downloaded: int = 0
    windows_analyzed: int = 0
    buffered_duration: float = 0.0
    events: List[Dict[str, Any]] = field(default_factory=list)
    clips: List[str] = field(default_factory=list)
    main_highlights: Optional[str] = None
    error: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


async def create_session(session: LiveSession) -> str:
    doc = session.to_dict()
    result = await live_col.insert_one(doc)
    return str(result.inserted_id)


async def update_session(session_id: str, updates: dict):
    updates["updated_at"] = datetime.utcnow().isoformat()
    await live_col.update_one(
        {"session_id": session_id},
        {"$set": updates}
    )


async def get_session(session_id: str) -> Optional[dict]:
    doc = await live_col.find_one({"session_id": session_id})
    if doc:
        doc["_id"] = str(doc["_id"])
    return doc


async def list_sessions(limit: int = 50) -> List[dict]:
    cursor = live_col.find({}).sort("created_at", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    for d in docs:
        d["_id"] = str(d["_id"])
    return docs


async def push_event(session_id: str, event: dict):
    """Append a single verified event to the session document."""
    await live_col.update_one(
        {"session_id": session_id},
        {
            "$push": {"events": event, "clips": event.get("clip_url", "")},
            "$set": {"updated_at": datetime.utcnow().isoformat()}
        }
    )

async def delete_session(session_id: str):
    """Delete a session document from MongoDB."""
    await live_col.delete_one({"session_id": session_id})
