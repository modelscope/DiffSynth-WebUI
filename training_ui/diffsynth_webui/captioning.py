from __future__ import annotations

import base64
import http.client
import io
import json
import mimetypes
import shutil
import socket
import ssl
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict
from urllib import error, request
from urllib.parse import urlparse
from PIL import Image
from . import config
from .caption_models import CaptionModel


DEFAULT_INSTRUCTION = "Generate an accurate, natural caption for this input. Return only the caption."
_MAX_MEDIA_BYTES = 50 * 1024 * 1024
_MAX_INLINE_AUDIO_BYTES = 19 * 1024 * 1024
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class CaptioningConfigurationError(ValueError):
    """Raised when the API settings are invalid."""


def _image_data_url(path: Path) -> str:
    with Image.open(path) as image:
        image.thumbnail((2048, 2048))
        if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
            rgba = image.convert("RGBA")
            background = Image.new("RGBA", rgba.size, "white")
            background.alpha_composite(rgba)
            image = background.convert("RGB")
        else:
            image = image.convert("RGB")
        encoded = io.BytesIO()
        quality = 90
        while True:
            encoded.seek(0)
            encoded.truncate(0)
            image.save(encoded, format="JPEG", quality=quality, optimize=True)
            if encoded.tell() <= 6 * 1024 * 1024 or quality <= 55:
                break
            quality -= 10
    return f"data:image/jpeg;base64,{base64.b64encode(encoded.getvalue()).decode('ascii')}"


def _file_data_url(path: Path) -> str:
    size = path.stat().st_size
    if size > _MAX_MEDIA_BYTES:
        raise ValueError(
            f"Media is too large for an inline API request ({size / 1024 / 1024:.1f} MB; maximum 50 MB)"
        )
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def _encode_audio(path: Path) -> tuple[str, str]:
    if path.stat().st_size <= _MAX_INLINE_AUDIO_BYTES:
        return base64.b64encode(path.read_bytes()).decode("ascii"), path.suffix.lower().removeprefix(".")

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to prepare audio files larger than 19 MB")
    with tempfile.TemporaryDirectory(prefix="diffsynth_caption_audio_") as temp_dir:
        output = Path(temp_dir) / "audio.mp3"
        command = [
            ffmpeg, "-v", "error", "-i", str(path), "-vn", "-map_metadata", "-1",
            "-codec:a", "libmp3lame", "-b:a", "128k", "-fs", str(_MAX_INLINE_AUDIO_BYTES),
            "-y", str(output),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=180)
        if completed.returncode == 0 and output.is_file() and output.stat().st_size > 0:
            data = output.read_bytes()
            if len(data) <= _MAX_INLINE_AUDIO_BYTES:
                return base64.b64encode(data).decode("ascii"), "mp3"
        detail = completed.stderr.strip()[-1000:]
        raise RuntimeError(f"Unable to prepare audio for the Caption API: {detail or 'ffmpeg failed'}")


def _media_content(path: Path, dashscope: bool = False) -> Dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix in config.IMAGE_EXTS:
        return {"type": "image_url", "image_url": {"url": _image_data_url(path)}}
    if suffix in config.VIDEO_EXTS:
        return {"type": "video_url", "video_url": {"url": _file_data_url(path)}}
    if suffix in config.AUDIO_EXTS:
        data, audio_format = _encode_audio(path)
        if audio_format == "m4a":
            audio_format = "mp4"
        if dashscope:
            mime = "audio/mpeg" if audio_format == "mp3" else f"audio/{audio_format}"
            data = f"data:{mime};base64,{data}"
        return {"type": "input_audio", "input_audio": {"data": data, "format": audio_format}}
    raise ValueError(f"Unsupported caption media type: {path.suffix or path.name}")


def _validate_base_url(value: str) -> str:
    base_url = value.strip().rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise CaptioningConfigurationError("Caption API Base URL must be a valid HTTP(S) URL")
    return base_url


def _response_text(payload: Dict[str, Any]) -> str:
    content: Any = payload.get("output_text")
    if not content:
        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            try:
                content = payload["choices"][0]["text"]
            except (KeyError, IndexError, TypeError) as exc:
                raise RuntimeError("The response does not contain a usable caption") from exc
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "".join(item.get("text", "") for item in content if isinstance(item, dict)).strip()
    raise RuntimeError("The response returned an unrecognized content format")


def generate_prompt(
    media_path: Path,
    model: CaptionModel,
    instruction: str = "",
    current_prompt: str = "",
) -> str:
    api_key = model.api_key.strip()
    if not api_key:
        raise CaptioningConfigurationError("The selected model has no API key")
    base_url = _validate_base_url(model.base_url)
    if not model.model_id.strip():
        raise CaptioningConfigurationError("The selected model has no model ID")

    suffix = media_path.suffix.lower()
    supported = (
        (suffix in config.IMAGE_EXTS and model.supports_image)
        or (suffix in config.VIDEO_EXTS and model.supports_video)
        or (suffix in config.AUDIO_EXTS and model.supports_audio)
    )
    if not supported:
        raise CaptioningConfigurationError(
            f"Model {model.name!r} does not support this media type"
        )

    text = (instruction or DEFAULT_INSTRUCTION).strip()[:4000]
    existing = current_prompt.strip()
    if existing:
        text += f"\nCurrent caption:\n{existing[:8000]}\nRewrite the current caption using the media as the source of truth."
    text += "\nReturn only the caption. Do not explain, use Markdown, or add quotation marks."

    base_host = (urlparse(base_url).hostname or "").lower()
    is_dashscope = base_host.endswith("dashscope.aliyuncs.com")
    body: Dict[str, Any] = {
        "model": model.model_id,
        "messages": [{"role": "user", "content": [_media_content(media_path, dashscope=is_dashscope), {"type": "text", "text": text}]}],
        "temperature": 0.2,
        "max_tokens": 512,
    }
    req = request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=180) as response:
            raw = response.read(_MAX_RESPONSE_BYTES)
    except error.HTTPError as exc:
        detail = exc.read(4096).decode("utf-8", errors="replace")
        if media_path.suffix.lower() in config.AUDIO_EXTS and "incorrect modal `audio`" in detail:
            raise RuntimeError(
                f"Model {model.model_id!r} does not support audio input. Select an audio-capable model "
            ) from exc
        raise RuntimeError(f"Caption API request failed ({exc.code}): {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Unable to connect to the Caption API: {exc.reason}") from exc
    except (TimeoutError, socket.timeout) as exc:
        raise RuntimeError("The Caption API request timed out") from exc
    except (ConnectionError, http.client.RemoteDisconnected, ssl.SSLError, OSError) as exc:
        raise RuntimeError(f"Caption API connection interrupted: {exc}") from exc

    try:
        result = _response_text(json.loads(raw.decode("utf-8")))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise RuntimeError("The Caption API returned invalid JSON") from exc
    if not result:
        raise RuntimeError("The Caption API returned an empty caption")
    return result
