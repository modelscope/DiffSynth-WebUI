from __future__ import annotations

import sys
import tempfile
import shutil
import mimetypes
import re
import sqlite3
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

from diffsynth_webui import (
    artifacts,
    caption_models,
    captioning,
    config,
    datasets as ds_core,
    gpu_info,
    tasks as task_core,
    recipes as recipes_core,
    runner,
    settings as settings_core,
)


settings_core.apply_path_settings()

app = FastAPI(title="DiffSynth-WebUI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Ok(BaseModel):
    ok: bool = True
    message: str = ""


@app.get("/api/meta")
def api_meta():
    effective_settings = settings_core.get_all()
    model_base_value = effective_settings.get("DIFFSYNTH_MODEL_BASE_PATH", "").strip()
    model_base_path = config.resolve_webui_path(model_base_value or "DiffSynth-Studio/models")
    return {
        "diffsynth_studio_root": str(config.DIFFSYNTH_STUDIO_ROOT),
        "ui_data_root": str(config.UI_DATA_ROOT),
        "datasets_root": str(config.DATASETS_ROOT),
        "outputs_root": str(config.OUTPUTS_ROOT),
        "model_base_path": str(model_base_path.resolve()),
    }


@app.get("/api/gpu")
def api_gpu():
    return {"gpus": gpu_info.get_gpus()}


@app.get("/api/recipes")
def api_list_recipes():
    result = []
    for name in recipes_core.list_recipes():
        r = recipes_core.get_recipe(name)
        result.append({
            "name": r.name,
            "label": r.label,
            "train_script": r.train_script,
            "config_path": r.config_path,
            "source_script": r.source_script,
            "generation_type": r.generation_type,
            "family": r.family,
            "dataset_kind": r.dataset_kind,
            "lora_base_model": r.lora_base_model,
            "default_lora_target": r.default_lora_target,
            "default_model_paths": [mp.__dict__ for mp in r.default_model_paths],
            "extra_defaults": r.extra_defaults,
            "default_data_file_keys": r.default_data_file_keys,
            "default_resolution_mode": r.default_resolution_mode,
            "default_max_pixels": r.default_max_pixels,
            "default_height": r.default_height,
            "default_width": r.default_width,
            "default_num_frames": r.default_num_frames,
            "fixed_training_args": r.fixed_training_args,
            "default_dataset_repeat": r.default_dataset_repeat,
            "default_lr": r.default_lr,
            "default_epochs": r.default_epochs,
            "default_lora_rank": r.default_lora_rank,
            "default_optimizer": r.default_optimizer,
            "default_enable_custom_lora_target": r.default_enable_custom_lora_target,
            "default_sample_prompts": r.default_sample_prompts,
            "sampling": r.sampling,
            "disable_sections": r.disable_sections,
            "additional_sections": r.additional_sections,
            "dataset_repeat_stage_index": r.dataset_repeat_stage_index,
            "editable_stage_parameters": r.editable_stage_parameters,
        })
    return {"recipes": result}


class CreateDatasetReq(BaseModel):
    name: str
    kind: str = "image"


def _pagination(page: int, page_size: int) -> tuple[int, int]:
    if page < 1:
        raise HTTPException(400, "page must be at least 1")
    if page_size not in {20, 50, 100, 1000}:
        raise HTTPException(400, "page_size must be one of 20, 50, 100, or 1000")
    return page, page_size


@app.get("/api/datasets")
def api_list_datasets(
    page: int = Query(1, ge=1),
    page_size: int = Query(20),
):
    page, page_size = _pagination(page, page_size)
    datasets, total = ds_core.list_datasets(page=page, page_size=page_size)
    return {
        "datasets": [d.__dict__ for d in datasets],
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": (total + page_size - 1) // page_size,
    }


@app.post("/api/datasets")
def api_create_dataset(req: CreateDatasetReq):
    try:
        d = ds_core.create_dataset(req.name, kind=req.kind)
    except FileExistsError as e:
        raise HTTPException(400, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return d.__dict__


@app.delete("/api/datasets/{name}")
def api_delete_dataset(name: str):
    ds_core.delete_dataset(name)
    return Ok(message=f"deleted {name}")


@app.get("/api/datasets/{name}")
def api_dataset_detail(name: str):
    try:
        p = ds_core.dataset_path(name)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    return {
        "name": name,
        "path": str(p),
        "kind": ds_core.dataset_kind(name),
        "media": ds_core.list_media(name),
        "metadata": ds_core.read_metadata(name),
        "extra_input_keys": ds_core.get_extra_input_keys(name),
    }


class MetadataReq(BaseModel):
    items: List[Dict[str, Any]]


class DeleteMediaReq(BaseModel):
    files: List[str]


class GeneratePromptReq(BaseModel):
    media_path: str
    caption_model_id: str
    current_prompt: str = ""
    instruction: str = ""


def _upload_filename(value: str | None) -> str:
    raw = (value or "").replace("\\", "/")
    filename = Path(raw).name
    if not filename or filename in {".", ".."} or "\x00" in filename:
        raise HTTPException(400, "Invalid upload filename")
    return filename


@app.put("/api/datasets/{name}/metadata")
def api_save_metadata(name: str, req: MetadataReq):
    try:
        ds_core.dataset_path(name)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    ds_core.write_metadata(name, req.items)
    return Ok(message=f"saved {len(req.items)} items")


@app.post("/api/datasets/{name}/generate_prompt")
def api_generate_dataset_prompt(name: str, req: GeneratePromptReq):
    try:
        path = ds_core.media_path_path(name, req.media_path)
        model = caption_models.get_model(req.caption_model_id)
        prompt = captioning.generate_prompt(
            path,
            model=model,
            instruction=req.instruction,
            current_prompt=req.current_prompt,
        )
    except KeyError:
        raise HTTPException(404, "prompt model not found")
    except captioning.CaptioningConfigurationError as e:
        raise HTTPException(409, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        detail = str(e).strip() or repr(e)
        raise HTTPException(502, f"Caption generation failed ({type(e).__name__}): {detail}") from e
    return {"prompt": prompt}


@app.post("/api/datasets/{name}/upload")
async def api_upload_files(name: str, files: List[UploadFile] = File(...)):
    try:
        ds_core.dataset_path(name)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    tmp_paths: List[Path] = []
    tempdir = Path(tempfile.mkdtemp(prefix="diffsynth_webui_upload_"))
    try:
        for f in files:
            filename = _upload_filename(f.filename)
            tp = tempdir / filename
            if tp.exists():
                raise ValueError(f"Duplicate filename in the same upload: {filename}")
            with tp.open("wb") as output:
                while chunk := await f.read(1024 * 1024):
                    output.write(chunk)
            tmp_paths.append(tp)
        try:
            saved = ds_core.add_files(name, tmp_paths)
        except (ValueError, FileExistsError) as e:
            raise HTTPException(400, str(e)) from e
    finally:
        for f in files:
            await f.close()
        shutil.rmtree(tempdir, ignore_errors=True)
    return {"saved": saved}


@app.post("/api/datasets/{name}/media/{filename:path}/edit-inputs")
async def api_upload_edit_inputs(name: str, filename: str, files: List[UploadFile] = File(...)):
    tempdir = Path(tempfile.mkdtemp(prefix="diffsynth_webui_edit_inputs_"))
    tmp_paths: List[Path] = []
    try:
        for upload in files:
            upload_name = _upload_filename(upload.filename)
            temp_path = tempdir / upload_name
            if temp_path.exists():
                raise HTTPException(400, f"Duplicate filename in the same upload: {upload_name}")
            with temp_path.open("wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    output.write(chunk)
            tmp_paths.append(temp_path)
        try:
            saved = ds_core.add_edit_inputs(name, filename, tmp_paths)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e)) from e
        except (ValueError, FileExistsError) as e:
            raise HTTPException(400, str(e)) from e
    finally:
        for upload in files:
            await upload.close()
        shutil.rmtree(tempdir, ignore_errors=True)
    return {"saved": saved}


@app.delete("/api/datasets/{name}/media/{filename:path}/edit-inputs")
def api_delete_edit_inputs(name: str, filename: str, req: DeleteMediaReq):
    try:
        deleted = ds_core.delete_edit_inputs(name, filename, req.files)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"deleted": deleted}


@app.post("/api/datasets/{name}/media/{filename:path}/fields/{field}")
async def api_upload_field_media(name: str, filename: str, field: str, files: List[UploadFile] = File(...)):
    tempdir = Path(tempfile.mkdtemp(prefix="diffsynth_webui_field_"))
    tmp_paths: List[Path] = []
    try:
        for upload in files:
            path = tempdir / _upload_filename(upload.filename)
            if path.exists():
                raise HTTPException(400, f"Duplicate filename in the same upload: {path.name}")
            with path.open("wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    output.write(chunk)
            tmp_paths.append(path)
        saved = ds_core.add_field_media(name, filename, field, tmp_paths)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    except (ValueError, FileExistsError) as e:
        raise HTTPException(400, str(e)) from e
    finally:
        for upload in files:
            await upload.close()
        shutil.rmtree(tempdir, ignore_errors=True)
    return {"saved": saved}


@app.delete("/api/datasets/{name}/media/{filename:path}/fields/{field}")
def api_delete_field_media(name: str, filename: str, field: str, req: DeleteMediaReq):
    try:
        deleted = ds_core.delete_field_media(name, filename, field, req.files)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"deleted": deleted}


@app.delete("/api/datasets/{name}/media")
def api_delete_media(name: str, req: DeleteMediaReq):
    try:
        deleted = ds_core.delete_media(name, req.files)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"deleted": deleted}


@app.get("/api/datasets/{name}/media/{filename:path}")
def api_get_media(name: str, filename: str):
    try:
        d = ds_core.dataset_path(name)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    p = (d / filename).resolve()
    try:
        p.relative_to(d.resolve())
    except ValueError:
        raise HTTPException(404, "file not found")
    if not p.is_file():
        raise HTTPException(404, "file not found")
    return FileResponse(p)


class CreateTaskReq(BaseModel):
    name: str
    config: Dict[str, Any]
    start_now: bool = True


class UpdateTaskReq(BaseModel):
    name: str
    config: Dict[str, Any]


def _validate_task_config(cfg: Dict[str, Any]) -> tuple[str, str]:
    model_type = str(cfg.get("model_type") or "")
    dataset = str(cfg.get("dataset") or "")
    if not model_type:
        raise HTTPException(400, "config.model_type is required")
    if not dataset:
        raise HTTPException(400, "config.dataset is required")
    try:
        recipe = recipes_core.get_recipe(model_type)
    except KeyError:
        raise HTTPException(400, f"unknown model type: {model_type}")
    try:
        ds_core.dataset_path(dataset)
    except FileNotFoundError:
        raise HTTPException(400, f"dataset not found: {dataset}")
    gpu_index = cfg.get("gpu_index")
    if isinstance(gpu_index, bool) or not isinstance(gpu_index, int) or gpu_index < 0:
        raise HTTPException(400, "config.gpu_index must be a non-negative integer")
    checkpoint = str(cfg.get("resume_from_checkpoint") or "").strip()
    if checkpoint:
        checkpoint_path = Path(checkpoint).expanduser()
        if len(recipe.training_stages) > 1:
            raise HTTPException(400, "resume_from_checkpoint is only supported for single-stage training")
        if not checkpoint_path.is_file():
            raise HTTPException(400, f"resume_from_checkpoint does not exist: {checkpoint_path}")
    return model_type, dataset


@app.get("/api/tasks")
def api_list_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20),
    status: str = Query("all"),
):
    page, page_size = _pagination(page, page_size)
    if status not in {"all", "running", "history"}:
        raise HTTPException(400, "status must be all, running, or history")
    # Refresh active processes before counting and slicing, so tab totals stay consistent.
    all_tasks = [
        runner.refresh_status(task.id)
        if task.status in task_core.ACTIVE_RUN_STATUSES else task
        for task in task_core.list_tasks()
    ]
    active = [task for task in all_tasks if task.status in task_core.ACTIVE_RUN_STATUSES]
    history = [task for task in all_tasks if task.status not in task_core.ACTIVE_RUN_STATUSES]
    selected = {"all": all_tasks, "running": active, "history": history}[status]
    total = len(selected)
    start = (page - 1) * page_size
    tasks = selected[start:start + page_size]
    return {
        "tasks": [task.to_dict() for task in tasks],
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": (total + page_size - 1) // page_size,
        "counts": {
            "all": len(all_tasks),
            "running": len(active),
            "history": len(history),
        },
    }


@app.post("/api/tasks")
def api_create_task(req: CreateTaskReq):
    cfg = req.config or {}
    if not req.name.strip():
        raise HTTPException(400, "name is required")
    model_type, dataset = _validate_task_config(cfg)
    try:
        task = task_core.create_task(name=req.name.strip(), model_type=model_type, dataset=dataset, config_data=cfg)
    except Exception as e:
        raise HTTPException(400, f"create task failed: {e}")
    if req.start_now:
        try:
            runner.start_task(task.id)
        except Exception as e:
            raise HTTPException(500, f"start task failed: {e}")
    result = task_core.get_task(task.id).to_dict()
    result["preview_command"] = result.get("command", [])
    return result


@app.put("/api/tasks/{task_id}")
def api_update_task(task_id: str, req: UpdateTaskReq):
    cfg = req.config or {}
    if not req.name.strip():
        raise HTTPException(400, "name is required")
    model_type, dataset = _validate_task_config(cfg)
    try:
        task = task_core.edit_task(
            task_id,
            name=req.name.strip(),
            model_type=model_type,
            dataset=dataset,
            config_data=cfg,
        )
        return task.to_dict()
    except KeyError:
        raise HTTPException(404, "task not found")
    except ValueError as e:
        raise HTTPException(409, str(e))
    except Exception as e:
        raise HTTPException(400, f"update task failed: {e}")


_SAMPLING_INPUT_EXTENSIONS = {
    "image": {".png", ".jpg", ".jpeg", ".webp", ".bmp"},
    "video": {".mp4", ".mov", ".avi", ".mkv", ".webm"},
    "audio": {".mp3", ".wav", ".flac", ".ogg", ".m4a"},
}


@app.post("/api/tasks/{task_id}/sampling-inputs/{sample_id}/{field_name}")
async def api_upload_sampling_inputs(
    task_id: str,
    sample_id: str,
    field_name: str,
    files: List[UploadFile] = File(...),
):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", sample_id):
        raise HTTPException(400, "invalid sampling sample id")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", field_name):
        raise HTTPException(400, "invalid sampling input field")
    try:
        task = task_core.get_task(task_id)
    except KeyError:
        raise HTTPException(404, "task not found")
    if task.latest_run and task.latest_run.status in task_core.ACTIVE_RUN_STATUSES:
        raise HTTPException(409, "Sampling inputs cannot be changed while the task is running")
    recipe = recipes_core.get_recipe(task.model_type)
    schema = recipe.sampling.get("input_schema") or []
    definition = next(
        (item for item in schema if isinstance(item, dict) and item.get("name") == field_name),
        None,
    )
    if definition is None:
        raise HTTPException(400, f"sampling input is not supported by this model: {field_name}")
    if not definition.get("multiple") and len(files) != 1:
        raise HTTPException(400, f"sampling input {field_name} accepts exactly one file")
    required_count = int(definition.get("count") or 0)
    if required_count and len(files) != required_count:
        raise HTTPException(
            400,
            f"sampling input {field_name} requires exactly {required_count} files",
        )
    input_type = str(definition.get("type") or "")
    allowed = _SAMPLING_INPUT_EXTENSIONS.get(input_type)
    if not allowed:
        raise HTTPException(400, f"unsupported sampling input type: {input_type}")
    target_dir = Path(task.task_dir) / "sampling_inputs" / sample_id / field_name
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    saved: List[str] = []
    try:
        for upload in files:
            filename = _upload_filename(upload.filename)
            if Path(filename).suffix.lower() not in allowed:
                raise HTTPException(400, f"invalid {input_type} file: {filename}")
            target = target_dir / filename
            if target.exists():
                raise HTTPException(400, f"duplicate upload filename: {filename}")
            with target.open("wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    output.write(chunk)
            saved.append(target.relative_to(Path(task.task_dir)).as_posix())
    except Exception:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise
    finally:
        for upload in files:
            await upload.close()
    return {"saved": saved}


@app.get("/api/tasks/{task_id}")
def api_get_task(task_id: str):
    try:
        task = task_core.get_task(task_id)
    except KeyError:
        raise HTTPException(404, "task not found")
    task = runner.refresh_status(task.id)
    return task.to_dict()


@app.post("/api/tasks/{task_id}/start")
def api_start_task(task_id: str):
    try:
        task_core.get_task(task_id)
    except KeyError:
        raise HTTPException(404, "task not found")
    try:
        runner.start_task(task_id)
    except Exception as e:
        raise HTTPException(500, f"start failed: {e}")
    return task_core.get_task(task_id).to_dict()


@app.post("/api/tasks/{task_id}/stop")
def api_stop_task(task_id: str):
    try:
        task_core.get_task(task_id)
    except KeyError:
        raise HTTPException(404, "task not found")
    runner.stop_task(task_id)
    return task_core.get_task(task_id).to_dict()


@app.delete("/api/tasks/{task_id}")
def api_delete_task(task_id: str):
    try:
        task = task_core.get_task(task_id)
    except KeyError:
        raise HTTPException(404, "task not found")
    if task.latest_run and task.latest_run.status in task_core.ACTIVE_RUN_STATUSES:
        raise HTTPException(409, "A running task cannot be deleted. Stop it first.")
    task_root = Path(task.task_dir).resolve()
    if not task_root.name.startswith(f"{task.id}_"):
        raise HTTPException(500, f"invalid task output directory: {task_root}")
    for run in task_core.list_runs(task_id):
        target = Path(run.output_path).resolve()
        try:
            target.relative_to(task_root)
        except ValueError:
            raise HTTPException(500, f"run output is outside the task directory: {target}")
    if task_root.exists():
        shutil.rmtree(task_root)
    task_core.delete_task_records(task_id)
    return Ok(message=f"deleted {task_id}")


@app.get("/api/tasks/{task_id}/log", response_class=PlainTextResponse)
def api_get_log(task_id: str):
    try:
        return runner.read_log(task_id)
    except KeyError:
        raise HTTPException(404, "task not found")


@app.get("/api/tasks/{task_id}/samples")
def api_task_samples(task_id: str):
    _require_task(task_id)
    return {"samples": artifacts.list_samples(task_id)}


@app.get("/api/tasks/{task_id}/sampling_status")
def api_task_sampling_status(task_id: str):
    _require_task(task_id)
    return artifacts.read_sampling_status(task_id)


@app.get("/api/tasks/{task_id}/checkpoints")
def api_task_checkpoints(task_id: str):
    _require_task(task_id)
    return {"checkpoints": artifacts.list_checkpoints(task_id)}


@app.get("/api/tasks/{task_id}/files")
def api_task_files(task_id: str):
    _require_task(task_id)
    return {"files": artifacts.list_files(task_id)}


@app.get("/api/tasks/{task_id}/loss")
def api_task_loss(task_id: str):
    _require_task(task_id)
    return {"series": artifacts.read_loss(task_id)}


@app.get("/api/tasks/{task_id}/artifact")
def api_task_artifact(task_id: str, path: str, download: bool = False):
    _require_task(task_id)
    try:
        p = artifacts.read_artifact(task_id, path)
    except FileNotFoundError:
        raise HTTPException(404, "not found")
    except PermissionError as e:
        raise HTTPException(403, str(e))
    weight_extensions = {".safetensors", ".pt", ".pth", ".bin", ".ckpt", ".onnx", ".gguf", ".pkl", ".pickle"}
    if download:
        return FileResponse(
            p,
            filename=p.name,
            media_type="application/octet-stream",
            content_disposition_type="attachment",
        )
    if p.suffix.lower() in weight_extensions:
        raise HTTPException(400, "checkpoint and weight files can only be downloaded")
    text_extensions = {
        ".txt", ".log", ".json", ".jsonl", ".csv", ".tsv", ".yaml", ".yml",
        ".md", ".py", ".sh", ".toml", ".ini", ".cfg", ".xml", ".html", ".htm",
    }
    media_type = "text/plain; charset=utf-8" if p.suffix.lower() in text_extensions else None
    if media_type is None:
        media_type = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    return FileResponse(
        p,
        filename=p.name,
        media_type=media_type,
        content_disposition_type="inline",
        headers={"X-Content-Type-Options": "nosniff"},
    )


def _require_task(task_id: str) -> None:
    try:
        task_core.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(404, "task not found") from exc


class PreviewReq(BaseModel):
    config: Dict[str, Any]


@app.post("/api/preview_command")
def api_preview_command(req: PreviewReq):
    try:
        preview_path = Path(tempfile.gettempdir()) / "diffsynth_webui_preview"
        argv, output_path, log_path = runner.build_command(req.config, preview_path)
    except Exception as e:
        raise HTTPException(400, f"build_command failed: {e}")
    return {"argv": argv, "output_path": output_path, "log_path": log_path}


@app.get("/api/settings")
def api_get_settings():
    public = settings_core.get_public()
    return {**public, "keys": settings_core.SETTING_KEYS}


class SettingsReq(BaseModel):
    settings: Dict[str, str]


@app.put("/api/settings")
def api_set_settings(req: SettingsReq):
    try:
        settings_core.set_many(req.settings or {})
        settings_core.apply_path_settings()
    except OSError as e:
        raise HTTPException(400, f"path is not writable: {e}")
    return settings_core.get_public()


class CaptionModelReq(BaseModel):
    name: str
    base_url: str
    api_key: str = ""
    model_id: str
    supports_image: bool = True
    supports_video: bool = False
    supports_audio: bool = False


@app.get("/api/caption-models")
def api_list_caption_models():
    return {"models": [model.public_dict() for model in caption_models.list_models()]}


@app.post("/api/caption-models")
def api_create_caption_model(req: CaptionModelReq):
    try:
        return caption_models.create_model(req.model_dump()).public_dict()
    except sqlite3.IntegrityError:
        raise HTTPException(409, "A model with this name already exists")
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.put("/api/caption-models/{model_id}")
def api_update_caption_model(model_id: str, req: CaptionModelReq):
    try:
        return caption_models.update_model(model_id, req.model_dump()).public_dict()
    except KeyError:
        raise HTTPException(404, "prompt model not found")
    except sqlite3.IntegrityError:
        raise HTTPException(409, "A model with this name already exists")
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/caption-models/{model_id}")
def api_delete_caption_model(model_id: str):
    try:
        caption_models.delete_model(model_id)
    except KeyError:
        raise HTTPException(404, "prompt model not found")
    return Ok(message="prompt model deleted")


@app.get("/api/health")
def health():
    return {"ok": True}
