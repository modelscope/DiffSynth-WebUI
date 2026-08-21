from __future__ import annotations

import re
import copy
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from .. import tasks, recipes
from .executor import build_pipeline, run_sample
from .schema import SampleRequest, SamplingConfig


SAMPLING_CONFIG_FILE = "sampling_config.json"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _samples(config_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    values = config_data.get("samples") or []
    return [dict(value) for value in values if isinstance(value, dict)]


def _resolve_sample_inputs(
    run: tasks.TaskRunRecord,
    raw_inputs: Dict[str, Any],
    input_schema: List[Dict[str, Any]],
) -> Dict[str, Any]:
    # Sampling uploads are stored below the task directory and never accepted as absolute paths.
    root = Path(tasks.get_task(run.task_id).task_dir).resolve()
    resolved: Dict[str, Any] = {}
    for field in input_schema:
        name = str(field.get("name") or "")
        field_type = str(field.get("type") or "")
        if field_type in {"number", "string", "string_list"}:
            value = raw_inputs.get(name, field.get("default"))
            if field.get("required") and (value is None or value == "" or value == []):
                raise ValueError(f"sampling input {name!r} is required")
            resolved[name] = value
            continue
        raw_value = raw_inputs.get(name)
        values = raw_value if isinstance(raw_value, list) else ([raw_value] if raw_value else [])
        if bool(field.get("required")) and not values:
            raise ValueError(f"sampling input {name!r} is required")
        paths: List[str] = []
        for value in values:
            relative = Path(str(value).replace("\\", "/"))
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError(f"invalid sampling input path: {value!r}")
            path = (root / relative).resolve()
            try:
                path.relative_to(root)
            except ValueError as exc:
                raise ValueError(f"sampling input is outside the task directory: {value!r}") from exc
            if not path.is_file():
                raise FileNotFoundError(f"sampling input does not exist: {value}")
            paths.append(str(path))
        resolved[name] = paths if field.get("multiple") else (paths[0] if paths else None)
    return resolved


def _latest_checkpoint(output_path: str) -> Optional[Path]:
    root = Path(output_path)
    candidates = [path for path in root.rglob("*.safetensors") if path.is_file()]
    if not candidates:
        return None

    def order(path: Path) -> Tuple[int, int, float, str]:
        # Prefer the highest epoch/step number, then modification time.
        match = re.search(r"(epoch|step)[-_]?(\d+)", path.stem, re.I)
        kind = 1 if match and match.group(1).lower() == "epoch" else 0
        number = int(match.group(2)) if match else -1
        return kind, number, path.stat().st_mtime, str(path)

    return max(candidates, key=order)


def _fail(run_id: str, message: str) -> None:
    tasks.update_run(
        run_id,
        sampling_status="failed",
        sampling_message=message,
        sampling_finished_at=_now(),
    )


def _prepare_sampling_config(run: tasks.TaskRunRecord) -> Optional[Path]:
    raw_samples = _samples(run.config)
    if not raw_samples:
        tasks.update_run(
            run.id,
            sampling_status="skipped",
            sampling_message="No sampling requests configured.",
            sampling_finished_at=_now(),
        )
        return None

    recipe = recipes.get_recipe(str(run.config["model_type"]))
    sampling = recipe.sampling
    pipeline = copy.deepcopy(sampling.get("pipeline"))
    extension = str(sampling.get("output_extension") or "")
    input_schema = sampling.get("input_schema") or []
    if not isinstance(pipeline, dict) or not extension.startswith("."):
        _fail(run.id, f"Model {recipe.name} does not have a valid sampling configuration.")
        return None
    model_paths = run.config.get("model_paths") or []
    from_pretrained = pipeline.get("from_pretrained") or {}
    if model_paths and isinstance(from_pretrained.get("model_configs"), list):
        configs = []
        for item in model_paths:
            config = {}
            if item.get("local_path"):
                config["path"] = item["local_path"]
            elif item.get("model_id"):
                config["model_id"] = item["model_id"]
            if item.get("file_pattern"):
                config["origin_file_pattern"] = item["file_pattern"]
            if item.get("nf4"):
                excludes = [x.strip() for x in str(item.get("exclude_modules") or "").split(",") if x.strip()]
                config["quantize"] = {"$quantize_config": {"method": "bitsandbytes_nf4", "exclude_modules": excludes or None}}
            configs.append({"$model_config": config})
        from_pretrained["model_configs"] = configs
        pipeline["from_pretrained"] = from_pretrained
    checkpoint = _latest_checkpoint(run.output_path)
    if not checkpoint:
        _fail(run.id, "No .safetensors checkpoint was found after training.")
        return None

    sample_dir = (Path(run.output_path) / "final_samples").resolve()
    sample_dir.mkdir(parents=True, exist_ok=True)
    plan = SamplingConfig(
        run_id=run.id,
        model_type=recipe.name,
        pipeline=dict(pipeline),
        input_schema=list(input_schema),
        checkpoint=str(checkpoint.resolve()),
        output_dir=str(sample_dir),
        samples=[
            SampleRequest(
                prompt=str(sample.get("prompt") or "").strip(),
                inputs=_resolve_sample_inputs(
                    run,
                    sample.get("inputs") if isinstance(sample.get("inputs"), dict) else {},
                    input_schema,
                ),
                output=str(sample_dir / f"sample_{index:03d}{extension}"),
            )
            for index, sample in enumerate(raw_samples, 1)
        ],
    )
    config_path = sample_dir / SAMPLING_CONFIG_FILE
    plan.write(config_path)
    return config_path.resolve()


def run_sampling(run_id: str) -> str:
    run = tasks.get_run(run_id)
    config_path = _prepare_sampling_config(run)
    if config_path is None:
        return tasks.get_run(run_id).sampling_status
    plan = SamplingConfig.load(config_path)
    tasks.update_run(
        run_id,
        sampling_status="running",
        sampling_current=0,
        sampling_total=len(plan.samples),
        sampling_checkpoint=plan.checkpoint,
        sampling_script=f"{plan.pipeline['module']}:{plan.pipeline['class']}",
        sampling_message="",
        sampling_started_at=_now(),
        sampling_finished_at=None,
    )

    print(f"Loading {plan.pipeline['class']} and LoRA checkpoint {plan.checkpoint}", flush=True)
    try:
        pipe = build_pipeline(plan.pipeline, Path(plan.checkpoint))
    except Exception:
        traceback.print_exc()
        _fail(run_id, "Failed to initialize the sampling pipeline. Check the training logs.")
        return "failed"
    for sample_index, sample in enumerate(plan.samples):
        display_index = sample_index + 1
        tasks.update_run(run_id, sampling_current=display_index)
        print(
            f"\n===== Prompt {display_index} / {len(plan.samples)} =====\n"
            f"{sample.prompt}",
            flush=True,
        )
        try:
            run_sample(
                pipe,
                plan.model_type,
                plan.pipeline,
                plan.input_schema,
                sample.prompt,
                sample.inputs,
                Path(sample.output),
            )
            if not Path(sample.output).is_file():
                raise RuntimeError(f"pipeline did not create {sample.output}")
        except Exception:
            traceback.print_exc()
            _fail(
                run_id,
                f"Sampling failed for prompt {display_index}. Check the training logs.",
            )
            return "failed"

    tasks.update_run(
        run_id,
        sampling_status="finished",
        sampling_current=len(plan.samples),
        sampling_message="",
        sampling_finished_at=_now(),
    )
    return "finished"
