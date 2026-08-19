from __future__ import annotations

import os
from typing import Any, Dict

from . import config, db


SETTING_KEYS: Dict[str, Dict[str, Any]] = {
    "DIFFSYNTH_MODEL_BASE_PATH": {
        "env": "DIFFSYNTH_MODEL_BASE_PATH",
        "default": "DiffSynth-Studio/models",
        "label": "Model Download Path",
    },
    "DIFFSYNTH_DOWNLOAD_SOURCE": {
        "env": "DIFFSYNTH_DOWNLOAD_SOURCE",
        "default": "modelscope",
        "label": "Model Download Source (modelscope / huggingface)",
    },
    "DIFFSYNTH_ATTENTION_IMPLEMENTATION": {
        "env": "DIFFSYNTH_ATTENTION_IMPLEMENTATION",
        "default": "",
        "label": "Attention Implementation (flash_attn / sage_attn / sdpa / xformers)",
    },
    "MODEL_SAVE_ROOT": {
        "env": "DIFFSYNTH_OUTPUTS_ROOT",
        "default": "training_ui/data/outputs",
        "label": "Model Save Path (training output root)",
    },
    "DATASETS_ROOT": {
        "env": "DIFFSYNTH_DATASETS_ROOT",
        "default": "training_ui/data/datasets",
        "label": "Dataset Root Directory",
    },
}


def get_all() -> Dict[str, str]:
    with db.settings_conn() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    saved = {r["key"]: r["value"] for r in rows}
    out: Dict[str, str] = {}
    for k, meta in SETTING_KEYS.items():
        if k in saved:
            out[k] = saved[k]
        elif meta["env"] and os.environ.get(meta["env"]):
            out[k] = os.environ[meta["env"]]
        else:
            out[k] = meta["default"]
    return out


def get_public() -> Dict[str, Any]:
    return {"settings": get_all()}


def set_many(values: Dict[str, str]) -> None:
    for key in ("DATASETS_ROOT", "MODEL_SAVE_ROOT"):
        value = str(values.get(key, "")).strip()
        if value:
            config.resolve_webui_path(value).mkdir(parents=True, exist_ok=True)
    with db.settings_conn() as conn:
        for k, v in values.items():
            if k not in SETTING_KEYS:
                continue
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, v or ""),
            )


def apply_path_settings() -> None:
    values = get_all()
    dataset_value = values.get("DATASETS_ROOT", "").strip()
    output_value = values.get("MODEL_SAVE_ROOT", "").strip()
    config.DATASETS_ROOT = (
        config.resolve_webui_path(dataset_value)
        if dataset_value
        else config.DEFAULT_DATASETS_ROOT
    )
    config.OUTPUTS_ROOT = (
        config.resolve_webui_path(output_value)
        if output_value
        else config.DEFAULT_OUTPUTS_ROOT
    )
    config.ensure_dirs()


def build_env(base_env: Dict[str, str] | None = None) -> Dict[str, str]:
    env = dict(base_env if base_env is not None else os.environ)
    all_values = get_all()
    for k, meta in SETTING_KEYS.items():
        env_key = meta["env"]
        if not env_key:
            continue
        v = all_values.get(k, "")
        if v:
            env[env_key] = (
                str(config.resolve_webui_path(v))
                if k == "DIFFSYNTH_MODEL_BASE_PATH"
                else v
            )
    return env
