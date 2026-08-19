from __future__ import annotations

import os
from pathlib import Path


TRAINING_UI_ROOT: Path = Path(__file__).resolve().parents[1]
WEBUI_ROOT: Path = TRAINING_UI_ROOT.parent


def resolve_ui_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = TRAINING_UI_ROOT / path
    return path.resolve()


def resolve_webui_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = WEBUI_ROOT / path
    return path.resolve()


def resolve_project_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = DIFFSYNTH_STUDIO_ROOT / path
    return path.resolve()


def _resolve_ds_root() -> Path:
    env = os.environ.get("DIFFSYNTH_STUDIO_ROOT")
    if env:
        candidate = Path(env).expanduser().resolve()
        if (candidate / "diffsynth").is_dir() and (candidate / "examples").is_dir():
            return candidate
        raise RuntimeError(f"Invalid DIFFSYNTH_STUDIO_ROOT: {candidate}")
    for candidate in (WEBUI_ROOT / "DiffSynth-Studio", WEBUI_ROOT):
        if (candidate / "diffsynth").is_dir() and (candidate / "examples").is_dir():
            return candidate.resolve()
    raise RuntimeError(
        "Cannot locate DiffSynth-Studio; set DIFFSYNTH_STUDIO_ROOT to the project root"
    )

DIFFSYNTH_STUDIO_ROOT: Path = _resolve_ds_root()

UI_DATA_ROOT: Path = resolve_ui_path(
    os.environ.get("DIFFSYNTH_WEBUI_HOME", str(TRAINING_UI_ROOT / "data"))
)

DEFAULT_DATASETS_ROOT: Path = UI_DATA_ROOT / "datasets"
DEFAULT_OUTPUTS_ROOT: Path = UI_DATA_ROOT / "outputs"
DATASETS_ROOT: Path = resolve_webui_path(
    os.environ.get("DIFFSYNTH_DATASETS_ROOT", str(DEFAULT_DATASETS_ROOT))
)

OUTPUTS_ROOT: Path = resolve_webui_path(
    os.environ.get("DIFFSYNTH_OUTPUTS_ROOT", str(DEFAULT_OUTPUTS_ROOT))
)

DB_PATH: Path = UI_DATA_ROOT / "tasks.sqlite"

SETTINGS_DB_PATH: Path = UI_DATA_ROOT / "settings.sqlite"

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
AUDIO_EXTS = {".mp3", ".wav", ".flac", ".ogg", ".m4a"}
COMPRESSED_EXTS = {".zip", ".tar", ".tar.gz", ".tgz"}


def ensure_dirs() -> None:
    for p in (UI_DATA_ROOT, DATASETS_ROOT, OUTPUTS_ROOT):
        p.mkdir(parents=True, exist_ok=True)
