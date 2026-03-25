"""
live_models.py – Singleton loader for RobustMultiModalDetector.

Loads the ML models from generator/ once at process startup and reuses
across all live sessions to avoid loading 2+ GB of weights repeatedly.
"""
import sys
import os
from pathlib import Path

# Ensure generator/ is importable
GENERATOR_DIR = Path(__file__).parent.parent / "generator"
if str(GENERATOR_DIR) not in sys.path:
    sys.path.insert(0, str(GENERATOR_DIR))

# Import from generator/app2.py
from app2 import RobustMultiModalDetector, MultimodalFusionEngine, CONFIG as BASE_CONFIG  # noqa: E402

import copy

# Build a config tailored for live use – paths relative to generator/ dir
LIVE_CONFIG = copy.deepcopy(BASE_CONFIG)
LIVE_CONFIG["model1_path"] = str(GENERATOR_DIR / "models" / "best_swin_small_model_CALF.pth")
LIVE_CONFIG["model2_path"] = str(GENERATOR_DIR / "models" / "best_video_swin_model_20_epoch.pth")
LIVE_CONFIG["video_path"] = ""        # set per-window
LIVE_CONFIG["output_final_json"] = "" # set per-window

# Reduce batch size for live stream (less VRAM pressure)
LIVE_CONFIG["batch_size"] = 2
LIVE_CONFIG["frame_skip"] = 4        # slightly faster for live


class _ModelManager:
    """Thread-safe singleton that holds the detector (loaded once)."""

    def __init__(self):
        self._detector: RobustMultiModalDetector | None = None

    def load(self):
        if self._detector is None:
            print("[LiveModels] Loading ML models – this may take 30-60 seconds …")
            self._detector = RobustMultiModalDetector(LIVE_CONFIG)
            print("[LiveModels] ✓ Models loaded and ready.")
        return self._detector

    @property
    def detector(self) -> RobustMultiModalDetector:
        if self._detector is None:
            raise RuntimeError("Models not loaded yet. Call load() first.")
        return self._detector

    @property
    def fusion_engine(self) -> MultimodalFusionEngine:
        return self._detector.fusion_engine

    @property
    def audio_analyzer(self):
        return self._detector.audio_analyzer


model_manager = _ModelManager()
