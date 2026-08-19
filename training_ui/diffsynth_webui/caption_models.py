from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List
from urllib.parse import urlparse

from . import db


@dataclass(frozen=True)
class CaptionModel:
    id: str
    name: str
    base_url: str
    api_key: str
    model_id: str
    supports_image: bool
    supports_video: bool
    supports_audio: bool

    def public_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "base_url": self.base_url,
            "model_id": self.model_id,
            "supports_image": self.supports_image,
            "supports_video": self.supports_video,
            "supports_audio": self.supports_audio,
            "api_key_configured": bool(self.api_key),
        }


def _from_row(row: Any) -> CaptionModel:
    return CaptionModel(
        id=row["id"], name=row["name"], base_url=row["base_url"],
        api_key=row["api_key"], model_id=row["model_id"],
        supports_image=bool(row["supports_image"]),
        supports_video=bool(row["supports_video"]),
        supports_audio=bool(row["supports_audio"]),
    )


def _validate(data: Dict[str, Any], *, require_api_key: bool) -> Dict[str, Any]:
    name = str(data.get("name") or "").strip()
    base_url = str(data.get("base_url") or "").strip().rstrip("/")
    api_key = str(data.get("api_key") or "").strip()
    model_id = str(data.get("model_id") or "").strip()
    parsed = urlparse(base_url)
    if not name:
        raise ValueError("Model name is required")
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Base URL must be a valid HTTP(S) URL")
    if require_api_key and not api_key:
        raise ValueError("API key is required")
    if not model_id:
        raise ValueError("Model ID is required")
    modalities = [bool(data.get(key)) for key in ("supports_image", "supports_video", "supports_audio")]
    if not any(modalities):
        raise ValueError("Select at least one supported input type")
    return {
        "name": name, "base_url": base_url, "api_key": api_key,
        "model_id": model_id,
        "supports_image": int(modalities[0]), "supports_video": int(modalities[1]),
        "supports_audio": int(modalities[2]),
    }


def list_models() -> List[CaptionModel]:
    with db.settings_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM caption_models ORDER BY rowid"
        ).fetchall()
    return [_from_row(row) for row in rows]


def get_model(model_id: str) -> CaptionModel:
    with db.settings_conn() as conn:
        row = conn.execute("SELECT * FROM caption_models WHERE id = ?", (model_id,)).fetchone()
    if not row:
        raise KeyError(model_id)
    return _from_row(row)


def create_model(data: Dict[str, Any]) -> CaptionModel:
    values = _validate(data, require_api_key=True)
    now = datetime.now().isoformat(timespec="seconds")
    record_id = uuid.uuid4().hex
    with db.settings_conn() as conn:
        conn.execute(
            """INSERT INTO caption_models (
                id, name, base_url, api_key, model_id,
                supports_image, supports_video, supports_audio, created_at, updated_at
            ) VALUES (:id, :name, :base_url, :api_key, :model_id,
                :supports_image, :supports_video, :supports_audio, :created_at, :updated_at)""",
            {**values, "id": record_id, "created_at": now, "updated_at": now},
        )
    return get_model(record_id)


def update_model(model_id: str, data: Dict[str, Any]) -> CaptionModel:
    current = get_model(model_id)
    values = _validate(data, require_api_key=False)
    if not values["api_key"]:
        values["api_key"] = current.api_key
    with db.settings_conn() as conn:
        values.update(id=model_id, updated_at=datetime.now().isoformat(timespec="seconds"))
        conn.execute(
            """UPDATE caption_models SET name=:name, base_url=:base_url, api_key=:api_key,
                model_id=:model_id,
                supports_image=:supports_image, supports_video=:supports_video,
                supports_audio=:supports_audio, updated_at=:updated_at
               WHERE id=:id""",
            values,
        )
    return get_model(model_id)


def delete_model(model_id: str) -> None:
    with db.settings_conn() as conn:
        cursor = conn.execute("DELETE FROM caption_models WHERE id = ?", (model_id,))
        if cursor.rowcount == 0:
            raise KeyError(model_id)
