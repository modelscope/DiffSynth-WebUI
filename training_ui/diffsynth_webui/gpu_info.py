from __future__ import annotations

import shutil
import subprocess
import os
from typing import Any, Dict, List


def _run(cmd: List[str], timeout: float = 3.0) -> str:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode == 0:
            return result.stdout
    except Exception:
        pass
    return ""


def _nvidia_gpus() -> List[Dict[str, Any]]:
    if not shutil.which("nvidia-smi"):
        return []
    query = "index,uuid,name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu"
    output = _run(["nvidia-smi", f"--query-gpu={query}", "--format=csv,noheader,nounits"])
    gpus: List[Dict[str, Any]] = []
    for line in output.strip().splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 8:
            continue
        try:
            gpus.append({
                "index": int(parts[0]),
                "uuid": parts[1],
                "name": parts[2],
                "memory_total_mb": int(parts[3]),
                "memory_used_mb": int(parts[4]),
                "memory_free_mb": int(parts[5]),
                "utilization": int(parts[6]),
                "temperature": int(parts[7]),
            })
        except ValueError:
            continue
    return gpus


def _visible_nvidia_gpu(index: int, nvidia_gpus: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    visible = [item.strip() for item in os.environ.get("CUDA_VISIBLE_DEVICES", "").split(",") if item.strip()]
    if index < len(visible):
        token = visible[index]
        for gpu in nvidia_gpus:
            if token.isdigit() and gpu["index"] == int(token):
                return gpu
            if gpu["uuid"] == token or gpu["uuid"].startswith(token):
                return gpu
    return nvidia_gpus[index] if index < len(nvidia_gpus) else None


def get_gpus() -> List[Dict[str, Any]]:
    nvidia_gpus = _nvidia_gpus()
    # ROCm exposes AMD devices through PyTorch's CUDA-compatible API.
    try:
        import torch
        if torch.cuda.is_available():
            result: List[Dict[str, Any]] = []
            for index in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(index)
                telemetry = _visible_nvidia_gpu(index, nvidia_gpus)
                try:
                    free, total = torch.cuda.mem_get_info(index)
                    total_mb = int(total / (1024 ** 2))
                    free_mb = int(free / (1024 ** 2))
                    used_mb = max(0, total_mb - free_mb)
                except (RuntimeError, NotImplementedError):
                    total_mb = int(props.total_memory / (1024 ** 2))
                    free_mb = used_mb = 0
                result.append({
                    "index": index,
                    "name": str(props.name),
                    "memory_total_mb": total_mb,
                    "memory_used_mb": used_mb,
                    "memory_free_mb": free_mb,
                    "utilization": telemetry["utilization"] if telemetry else None,
                    "temperature": telemetry["temperature"] if telemetry else None,
                })
            return result
    except (ImportError, RuntimeError):
        pass

    # Keep detailed NVIDIA telemetry as a fallback when PyTorch is unavailable.
    return [{key: value for key, value in gpu.items() if key != "uuid"} for gpu in nvidia_gpus]
