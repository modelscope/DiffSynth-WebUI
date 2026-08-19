from __future__ import annotations

import json
import re
import shutil
import tarfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

from . import config

METADATA_FILENAME = "metadata.jsonl"
INFO_FILENAME = "_dataset_info.json"
EDIT_INPUTS_DIR = "_edit_inputs"
FIELDS_DIR = "_fields"

DATASET_KINDS = ["image", "video", "audio"]

def _validate_field_key(key: str) -> str:
    key = str(key or "").strip()
    if not key or key in {"image", "video", "audio", "prompt"} or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]*", key):
        raise ValueError("Invalid metadata field name")
    return key


@dataclass
class DatasetInfo:
    name: str
    path: str
    kind: str
    num_items: int


def _dataset_dir(name: str) -> Path:
    if not name or "/" in name or "\\" in name or name.startswith("."):
        raise ValueError(f"Invalid dataset name: {name!r}")
    return config.DATASETS_ROOT / name


def _read_info(dir_: Path) -> Dict[str, Any]:
    p = dir_ / INFO_FILENAME
    if p.is_file():
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"Invalid dataset info: {p}")
        return data
    return {}


def _write_info(dir_: Path, info: Dict[str, Any]) -> None:
    (dir_ / INFO_FILENAME).write_text(
        json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def list_datasets(*, page: int | None = None, page_size: int = 20) -> List[DatasetInfo] | tuple[List[DatasetInfo], int]:
    config.ensure_dirs()
    directories = [p for p in sorted(config.DATASETS_ROOT.iterdir()) if p.is_dir()]
    total = len(directories)
    if page is not None:
        start = (page - 1) * page_size
        directories = directories[start:start + page_size]
    result: List[DatasetInfo] = []
    for p in directories:
        info = _read_info(p)
        items = read_metadata(p.name)
        result.append(
            DatasetInfo(
                name=p.name,
                path=str(p),
                kind=info.get("kind", "image"),
                num_items=len(items),
            )
        )
    return (result, total) if page is not None else result


def create_dataset(name: str, kind: str = "image") -> DatasetInfo:
    if kind not in DATASET_KINDS:
        raise ValueError(f"kind must be one of {DATASET_KINDS}")
    d = _dataset_dir(name)
    if d.exists():
        raise FileExistsError(f"Dataset already exists: {name}")
    d.mkdir(parents=True, exist_ok=False)
    (d / METADATA_FILENAME).write_text("", encoding="utf-8")
    _write_info(d, {"kind": kind})
    return DatasetInfo(name=name, path=str(d), kind=kind, num_items=0)


def delete_dataset(name: str) -> None:
    d = _dataset_dir(name)
    if not d.exists():
        return
    shutil.rmtree(d)


def dataset_path(name: str) -> Path:
    d = _dataset_dir(name)
    if not d.exists():
        raise FileNotFoundError(f"Dataset does not exist: {name}")
    return d


def dataset_kind(name: str) -> str:
    return str(_read_info(dataset_path(name)).get("kind", "image"))


def image_path(name: str, media_path: str) -> Path:
    path = media_path_path(name, media_path)
    if path.suffix.lower() not in config.IMAGE_EXTS:
        raise FileNotFoundError(f"Image does not exist or has an unsupported format: {media_path}")
    return path


def media_path_path(name: str, media_path: str) -> Path:
    dataset_dir = dataset_path(name).resolve()
    relative = Path(str(media_path).replace("\\", "/"))
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError(f"Invalid image path: {media_path!r}")
    path = (dataset_dir / relative).resolve()
    try:
        path.relative_to(dataset_dir)
    except ValueError as exc:
        raise ValueError(f"Image path is outside the dataset directory: {media_path!r}") from exc
    if not path.is_file() or not _is_media(path):
        raise FileNotFoundError(f"Media does not exist or has an unsupported format: {media_path}")
    return path


def _relative_media_path(value: str) -> Path:
    relative = Path(str(value).replace("\\", "/"))
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError(f"Invalid media path: {value!r}")
    return relative


def _edit_input_dir(name: str, media_path: str) -> Path:
    d = dataset_path(name).resolve()
    relative = _relative_media_path(media_path)
    duplicate_names = [
        path for path in list_media(name)
        if Path(path).name == relative.name and path != relative.as_posix()
    ]
    if duplicate_names:
        raise ValueError(f"Multiple primary media files share this name; cannot determine the edit-image directory: {relative.name}")
    return d / EDIT_INPUTS_DIR / relative.stem


def add_edit_inputs(name: str, media_path: str, files: List[Path]) -> List[str]:
    media_path_path(name, media_path)
    target_dir = _edit_input_dir(name, media_path)
    existing_names = {path.name for path in target_dir.iterdir()} if target_dir.is_dir() else set()
    incoming_names = [Path(path).name for path in files]
    if len(set(incoming_names)) != len(incoming_names):
        raise ValueError("Duplicate edit-image filenames in the same upload")
    conflicts = sorted(set(incoming_names) & existing_names)
    if conflicts:
        raise FileExistsError(f"Edit images already exist: {', '.join(conflicts)}")
    for path in files:
        if not _is_media(Path(path)):
            raise ValueError(f"Related file must be supported media: {Path(path).name}")

    target_dir.mkdir(parents=True, exist_ok=True)
    saved: List[str] = []
    for src in files:
        target = target_dir / Path(src).name
        shutil.copyfile(src, target)
        saved.append(target.relative_to(dataset_path(name)).as_posix())

    items = read_metadata(name)
    item = next(
        (
            entry for entry in items
            if any(entry.get(field) == media_path for field in ("image", "video", "audio"))
        ),
        None,
    )
    if item is None:
        item = {_media_field(media_path): media_path, "prompt": ""}
        items.append(item)
    current = item.get("edit_image") or []
    if isinstance(current, str):
        current = [current]
    item["edit_image"] = [*current, *saved]
    write_metadata(name, items)
    return saved


def delete_edit_inputs(name: str, media_path: str, file_names: List[str]) -> List[str]:
    media_path_path(name, media_path)
    target_dir = _edit_input_dir(name, media_path).resolve()
    items = read_metadata(name)
    item = next(
        (
            entry for entry in items
            if any(entry.get(field) == media_path for field in ("image", "video", "audio"))
        ),
        None,
    )
    if item is None:
        return []
    current = item.get("edit_image") or []
    if isinstance(current, str):
        current = [current]
    selected = set(file_names)
    deleted: List[str] = []
    for value in current:
        if value not in selected:
            continue
        path = (dataset_path(name) / _relative_media_path(str(value))).resolve()
        try:
            path.relative_to(target_dir)
        except ValueError as exc:
            raise ValueError(f"Edit image does not belong to the current primary media: {value}") from exc
        if path.is_file():
            path.unlink()
            deleted.append(str(value))
    remaining = [value for value in current if value not in selected]
    if remaining:
        item["edit_image"] = remaining
    else:
        item.pop("edit_image", None)
    write_metadata(name, items)
    if target_dir.is_dir():
        try:
            target_dir.rmdir()
        except OSError:
            pass
    return deleted


def add_field_media(name: str, media_path: str, field: str, files: List[Path]) -> List[str]:
    media_path_path(name, media_path)
    field = _validate_field_key(field)
    if any(not _is_media(path) for path in files):
        raise ValueError("Related files must be supported media")
    items = read_metadata(name)
    item = next((it for it in items if any(it.get(k) == media_path for k in ("image", "video", "audio"))), None)
    if item is None:
        item = {_media_field(media_path): media_path, "prompt": ""}
        items.append(item)
    current = item.get(field)
    current_values = current if isinstance(current, list) else [current] if isinstance(current, str) and current else []
    def media_kind(value: str | Path) -> str:
        suffix = Path(value).suffix.lower()
        return "image" if suffix in config.IMAGE_EXTS else "video" if suffix in config.VIDEO_EXTS else "audio"
    if len({media_kind(value) for value in [*current_values, *files]}) > 1:
        raise ValueError("A file field cannot mix images, videos, and audio")
    target_dir = dataset_path(name) / "_fields" / Path(media_path).stem / field
    existing_names = {path.name for path in target_dir.iterdir()} if target_dir.is_dir() else set()
    conflicts = sorted(existing_names & {path.name for path in files})
    if conflicts:
        raise FileExistsError(f"Field files already exist: {', '.join(conflicts)}")
    target_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for src in files:
        target = target_dir / src.name
        shutil.copyfile(src, target)
        saved.append(target.relative_to(dataset_path(name)).as_posix())
    all_values = [*current_values, *saved]
    item[field] = all_values[0] if len(all_values) == 1 else all_values
    write_metadata(name, items)
    return saved


def delete_field_media(name: str, media_path: str, field: str, files: List[str]) -> List[str]:
    media_path_path(name, media_path)
    field = _validate_field_key(field)
    field_dir = dataset_path(name) / FIELDS_DIR / Path(media_path).stem / field
    items = read_metadata(name)
    item = next((it for it in items if any(it.get(k) == media_path for k in ("image", "video", "audio"))), None)
    if not item:
        return []
    value = item.get(field)
    values = value if isinstance(value, list) else [value] if value else []
    deleted = []
    for value in values:
        if value not in files:
            continue
        path = (dataset_path(name) / _relative_media_path(str(value))).resolve()
        allowed_dirs = [(dataset_path(name) / "_fields" / Path(media_path).stem / field).resolve()]
        if field == "edit_image":
            allowed_dirs.append(_edit_input_dir(name, media_path).resolve())
        if not any(path == directory or directory in path.parents for directory in allowed_dirs):
            raise ValueError("Field media does not belong to this metadata field")
        if path.is_file():
            path.unlink()
            deleted.append(str(value))
    remaining = [value for value in values if value not in files]
    if remaining:
        item[field] = remaining if isinstance(item.get(field), list) else remaining[0]
    else:
        item.pop(field, None)
        if field_dir.is_dir():
            shutil.rmtree(field_dir)
            try:
                field_dir.parent.rmdir()
            except OSError:
                pass
    write_metadata(name, items)
    return deleted


def metadata_path(name: str) -> Path:
    return dataset_path(name) / METADATA_FILENAME


def read_metadata(name: str) -> List[Dict[str, Any]]:
    p = _dataset_dir(name) / METADATA_FILENAME
    if not p.is_file():
        return []
    items: List[Dict[str, Any]] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(item, dict):
            continue
        media_path = next(
            (item.get(field) for field in ("image", "video", "audio") if item.get(field)),
            None,
        )
        if media_path and _is_archive_junk(Path(str(media_path))):
            continue
        items.append(item)
    return items


def write_metadata(name: str, items: List[Dict[str, Any]]) -> None:
    p = _dataset_dir(name) / METADATA_FILENAME
    with p.open("w", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")


def upsert_item(name: str, media_path: str, prompt: str, **extras: Any) -> None:
    items = read_metadata(name)
    field = _media_field(media_path)
    for it in items:
        if it.get(field) == media_path:
            it["prompt"] = prompt
            for k, v in extras.items():
                it[k] = v
            write_metadata(name, items)
            return
    row = {field: media_path, "prompt": prompt}
    row.update(extras)
    items.append(row)
    write_metadata(name, items)


def remove_item(name: str, media_path: str) -> None:
    items = [
        it for it in read_metadata(name)
        if all(it.get(field) != media_path for field in ("image", "video", "audio"))
    ]
    write_metadata(name, items)


def delete_media(name: str, file_names: List[str]) -> List[str]:
    d = dataset_path(name).resolve()
    targets: List[tuple[str, Path]] = []
    for file_name in dict.fromkeys(file_names):
        relative = Path(str(file_name).replace("\\", "/"))
        if relative.is_absolute() or ".." in relative.parts or not relative.parts:
            raise ValueError(f"Invalid media path: {file_name!r}")
        target = (d / relative).resolve()
        try:
            target.relative_to(d)
        except ValueError as exc:
            raise ValueError(f"Media path is outside the dataset directory: {file_name!r}") from exc
        if target.exists() and (not target.is_file() or not _is_media(target)):
            raise ValueError(f"Not a deletable media file: {file_name!r}")
        targets.append((relative.as_posix(), target))

    selected = {file_name for file_name, _ in targets}
    items = [
        item for item in read_metadata(name)
        if all(item.get(field) not in selected for field in ("image", "video", "audio"))
    ]
    deleted: List[str] = []
    for file_name, target in targets:
        if target.is_file():
            target.unlink()
            deleted.append(file_name)
        caption = target.with_suffix(".txt")
        if caption.is_file():
            caption.unlink()
        edit_input_dir = _edit_input_dir(name, file_name)
        if edit_input_dir.is_dir():
            shutil.rmtree(edit_input_dir)
        fields_dir = d / FIELDS_DIR / Path(file_name).stem
        if fields_dir.is_dir():
            shutil.rmtree(fields_dir)
        parent = target.parent
        while parent != d:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
    write_metadata(name, items)
    return deleted


def get_extra_input_keys(name: str) -> List[str]:
    excluded = {"image", "video", "audio", "edit_image", "prompt"}
    keys: set = set()
    for it in read_metadata(name):
        keys.update(it.keys())
    return sorted(k for k in keys if k not in excluded)


def _media_field(file_name: str) -> str:
    suffix = Path(file_name).suffix.lower()
    if suffix in config.VIDEO_EXTS:
        return "video"
    if suffix in config.AUDIO_EXTS:
        return "audio"
    return "image"


def _safe_relative_path(name: str) -> Path:
    raw = Path(name.replace("\\", "/"))
    if raw.is_absolute() or ".." in raw.parts or not raw.parts or "\x00" in name:
        raise ValueError(f"Archive contains an invalid path: {name!r}")
    return raw


def _is_archive_junk(path: Path) -> bool:
    lowered_parts = {part.lower() for part in path.parts}
    name = path.name.lower()
    return (
        "__macosx" in lowered_parts
        or name.startswith("._")
        or name in {".ds_store", "thumbs.db", "desktop.ini"}
    )


def _strip_common_archive_root(paths: List[Path]) -> List[Path]:
    if not paths or any(len(path.parts) < 2 for path in paths):
        return paths
    roots = {path.parts[0] for path in paths}
    if len(roots) != 1:
        return paths
    return [Path(*path.parts[1:]) for path in paths]


def _copy_archive_member(stream, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as out:
        shutil.copyfileobj(stream, out)


def _validate_archive_targets(paths: List[Path], target_dir: Path) -> None:
    # Validate the whole archive before writing any member to avoid partial imports.
    seen: set[Path] = set()
    duplicates: List[str] = []
    for path in paths:
        if path in seen:
            duplicates.append(path.as_posix())
        seen.add(path)
    if duplicates:
        raise ValueError(f"Archive contains duplicate paths: {', '.join(sorted(set(duplicates)))}")
    conflicts = sorted(path.as_posix() for path in paths if (target_dir / path).exists())
    if conflicts:
        raise FileExistsError(f"Archive files already exist: {', '.join(conflicts)}")


def _read_archive_metadata(stream) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for raw_line in stream.read().decode("utf-8-sig", errors="replace").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            items.append(item)
    return items


def _extract_zip(src: Path, target_dir: Path) -> tuple[List[Path], List[Dict[str, Any]]]:
    extracted: List[Path] = []
    metadata_items: List[Dict[str, Any]] = []
    with zipfile.ZipFile(src) as archive:
        entries = []
        for info in archive.infolist():
            if info.is_dir():
                continue
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError(f"Archive contains an unsupported link: {info.filename!r}")
            relative = _safe_relative_path(info.filename)
            if _is_archive_junk(relative) or relative.name == INFO_FILENAME:
                continue
            entries.append((info, relative))
        normalized = _strip_common_archive_root([relative for _, relative in entries])
        _validate_archive_targets(
            [path for path in normalized if path.name != METADATA_FILENAME],
            target_dir,
        )
        for (info, _), relative in zip(entries, normalized):
            with archive.open(info) as member:
                if relative.name == METADATA_FILENAME:
                    metadata_items.extend(_read_archive_metadata(member))
                    continue
                _copy_archive_member(member, target_dir / relative)
            extracted.append(relative)
    return extracted, metadata_items


def _extract_tar(src: Path, target_dir: Path) -> tuple[List[Path], List[Dict[str, Any]]]:
    extracted: List[Path] = []
    metadata_items: List[Dict[str, Any]] = []
    with tarfile.open(src) as archive:
        entries = []
        for member in archive.getmembers():
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError(f"Archive contains an unsupported special file: {member.name!r}")
            relative = _safe_relative_path(member.name)
            if _is_archive_junk(relative) or relative.name == INFO_FILENAME:
                continue
            entries.append((member, relative))
        normalized = _strip_common_archive_root([relative for _, relative in entries])
        _validate_archive_targets(
            [path for path in normalized if path.name != METADATA_FILENAME],
            target_dir,
        )
        for (member, _), relative in zip(entries, normalized):
            source = archive.extractfile(member)
            if source is None:
                continue
            with source:
                if relative.name == METADATA_FILENAME:
                    metadata_items.extend(_read_archive_metadata(source))
                    continue
                _copy_archive_member(source, target_dir / relative)
            extracted.append(relative)
    return extracted, metadata_items


def _merge_archive_metadata(name: str, imported: List[Dict[str, Any]]) -> None:
    if not imported:
        return
    items = read_metadata(name)
    existing_paths = {
        str(item.get(field)).replace("\\", "/").removeprefix("./")
        for item in items
        for field in ("image", "video", "audio")
        if item.get(field)
    }
    changed = False
    # Metadata is merged by media path; existing records remain authoritative.
    for item in imported:
        media_path = next(
            (item.get(field) for field in ("image", "video", "audio") if item.get(field)),
            None,
        )
        if not media_path:
            continue
        normalized = str(media_path).replace("\\", "/").removeprefix("./")
        if normalized in existing_paths:
            continue
        imported_item = dict(item)
        field = _media_field(normalized)
        for media_field in ("image", "video", "audio"):
            imported_item.pop(media_field, None)
        imported_item[field] = normalized
        items.append(imported_item)
        existing_paths.add(normalized)
        changed = True
    if changed:
        write_metadata(name, items)


def _sync_media_metadata(name: str, media_paths: List[Path]) -> None:
    if not media_paths:
        return
    d = dataset_path(name)
    items = read_metadata(name)
    index = {
        (field, str(item.get(field))): item
        for item in items
        for field in ("image", "video", "audio")
        if item.get(field)
    }
    changed = False
    for relative in media_paths:
        rel_name = relative.as_posix()
        field = _media_field(rel_name)
        caption_path = (d / relative).with_suffix(".txt")
        prompt = ""
        if caption_path.is_file():
            prompt = caption_path.read_text(encoding="utf-8", errors="replace").strip()
        item = index.get((field, rel_name))
        if item is None:
            item = {field: rel_name, "prompt": prompt}
            items.append(item)
            index[(field, rel_name)] = item
            changed = True
        elif caption_path.is_file() and item.get("prompt") != prompt:
            item["prompt"] = prompt
            changed = True
    if changed:
        write_metadata(name, items)

def add_files(name: str, files: List[Path]) -> List[str]:
    d = dataset_path(name)
    saved: List[str] = []
    media_paths: List[Path] = []
    imported_metadata: List[Dict[str, Any]] = []
    for src in files:
        src = Path(src)
        suffix = "".join(src.suffixes).lower()
        if suffix in {".zip"}:
            extracted, archive_metadata = _extract_zip(src, d)
            saved.append(f"[Extracted] {src.name}")
            media_paths.extend(
                p for p in extracted if _is_media(p) and EDIT_INPUTS_DIR not in p.parts
            )
            imported_metadata.extend(archive_metadata)
            continue
        if suffix in {".tar", ".tar.gz", ".tgz"} or src.name.endswith(".tar.gz"):
            extracted, archive_metadata = _extract_tar(src, d)
            saved.append(f"[Extracted] {src.name}")
            media_paths.extend(
                p for p in extracted if _is_media(p) and EDIT_INPUTS_DIR not in p.parts
            )
            imported_metadata.extend(archive_metadata)
            continue
        target = d / src.name
        if target.exists():
            raise FileExistsError(f"File already exists: {src.name}")
        shutil.copyfile(src, target)
        saved.append(target.name)
        if _is_media(target):
            media_paths.append(Path(target.name))
    _merge_archive_metadata(name, imported_metadata)
    _sync_media_metadata(name, media_paths)
    return saved

def _is_media(p: Path) -> bool:
    s = p.suffix.lower()
    return s in config.IMAGE_EXTS or s in config.VIDEO_EXTS or s in config.AUDIO_EXTS


def list_media(name: str) -> List[str]:
    d = dataset_path(name)
    files = []
    for p in sorted(d.rglob("*")):
        relative = p.relative_to(d)
        if (
            p.is_file()
            and _is_media(p)
            and EDIT_INPUTS_DIR not in relative.parts
            and FIELDS_DIR not in relative.parts
            and not _is_archive_junk(relative)
        ):
            files.append(relative.as_posix())
    return files
