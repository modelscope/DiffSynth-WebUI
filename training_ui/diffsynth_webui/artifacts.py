from __future__ import annotations

import csv
import math
import re
from pathlib import Path
from typing import Any, Dict, List

from . import tasks as task_core

_IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
_VIDEO_EXTS = {".mp4", ".mov", ".webm", ".gif"}
_AUDIO_EXTS = {".wav", ".mp3", ".flac", ".m4a", ".ogg"}
_SAMPLE_EXTS = _IMG_EXTS | _VIDEO_EXTS | _AUDIO_EXTS
_CKPT_EXTS = {".safetensors", ".pt", ".pth", ".bin"}
_LOSS_PATTERN = re.compile(
    r"(?:\bstep\s*[:=]\s*(\d+)[^\r\n]*?)?"
    r"\bloss\s*[:=]\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)",
    re.I,
)


def _output_dir(task_id: str) -> Path:
    task = task_core.get_task(task_id)
    if not task.output_path:
        raise FileNotFoundError("task has no output_path yet")
    p = Path(task.output_path)
    if not p.exists():
        raise FileNotFoundError(f"output dir not exist: {p}")
    return p


def list_checkpoints(task_id: str) -> List[Dict[str, Any]]:
    try:
        d = _output_dir(task_id)
    except FileNotFoundError:
        return []
    out: List[Dict[str, Any]] = []
    for p in sorted(d.rglob("*")):
        if p.is_file() and p.suffix.lower() in _CKPT_EXTS:
            out.append({
                "name": p.name,
                "rel_path": str(p.relative_to(d)),
                "size": p.stat().st_size,
                "mtime": p.stat().st_mtime,
            })
    return out


def list_samples(task_id: str) -> List[Dict[str, Any]]:
    try:
        d = _output_dir(task_id)
    except FileNotFoundError:
        return []
    sample_root = d / "final_samples"
    if not sample_root.is_dir():
        return []
    run = task_core.get_task(task_id).latest_run
    samples = (run.config.get("samples") if run else None) or []
    prompts = [
        str(sample.get("prompt") or "").strip()
        for sample in samples
        if isinstance(sample, dict) and str(sample.get("prompt") or "").strip()
    ]
    out: List[Dict[str, Any]] = []
    for p in sorted(sample_root.rglob("*")):
        if p.is_file() and p.suffix.lower() in _SAMPLE_EXTS:
            rel = str(p.relative_to(d))
            out.append({
                "name": p.name,
                "rel_path": rel,
                "mtime": p.stat().st_mtime,
                "kind": (
                    "image" if p.suffix.lower() in _IMG_EXTS
                    else "video" if p.suffix.lower() in _VIDEO_EXTS
                    else "audio"
                ),
                "prompt": prompts[len(out)] if len(out) < len(prompts) else None,
            })
    return out


def read_sampling_status(task_id: str) -> Dict[str, Any]:
    run = task_core.get_task(task_id).latest_run
    if not run:
        return {"status": "not_started", "outputs": []}
    return {
        "status": run.sampling_status,
        "current": run.sampling_current,
        "total": run.sampling_total,
        "checkpoint": run.sampling_checkpoint,
        "pipeline": run.sampling_script,
        "message": run.sampling_message,
        "started_at": run.sampling_started_at,
        "finished_at": run.sampling_finished_at,
        "outputs": [],
    }


def list_files(task_id: str) -> List[Dict[str, Any]]:
    try:
        d = _output_dir(task_id)
    except FileNotFoundError:
        return []
    out: List[Dict[str, Any]] = []
    for p in sorted(d.rglob("*")):
        if p.is_file():
            out.append({
                "name": p.name,
                "rel_path": str(p.relative_to(d)),
                "size": p.stat().st_size,
                "mtime": p.stat().st_mtime,
            })
    return out


def read_artifact(task_id: str, rel_path: str) -> Path:
    d = _output_dir(task_id)
    p = (d / rel_path).resolve()
    try:
        p.relative_to(d.resolve())
    except ValueError:
        raise PermissionError("path escapes task output dir")
    if not p.is_file():
        raise FileNotFoundError(str(p))
    return p


def read_loss(task_id: str) -> List[Dict[str, Any]]:
    try:
        d = _output_dir(task_id)
    except FileNotFoundError:
        return []
    series: List[Dict[str, Any]] = []

    csv_path = d / "loss.csv"
    if csv_path.is_file():
        try:
            with csv_path.open("r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        if row.get("key") != "loss":
                            continue
                        step = int(float(row["step"]))
                        loss = float(row["value"])
                        if math.isfinite(loss):
                            series.append({"step": step, "loss": loss})
                    except (TypeError, ValueError):
                        continue
        except (OSError, csv.Error):
            series = []
        if series:
            return series
    return []
