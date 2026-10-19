from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


MODEL_CONFIG_ROOT = Path(__file__).resolve().parents[1] / "model_configs"

PIPELINE_MODULES = {
    "AceStepPipeline": "diffsynth.pipelines.ace_step",
    "AnimaImagePipeline": "diffsynth.pipelines.anima_image",
    "BooguImagePipeline": "diffsynth.pipelines.boogu_image",
    "ErnieImagePipeline": "diffsynth.pipelines.ernie_image",
    "Flux2ImagePipeline": "diffsynth.pipelines.flux2_image",
    "Flux3ImagePipeline": "diffsynth.pipelines.flux3_image",
    "FluxImagePipeline": "diffsynth.pipelines.flux_image",
    "HiDreamO1ImagePipeline": "diffsynth.pipelines.hidream_o1_image",
    "Ideogram4Pipeline": "diffsynth.pipelines.ideogram4",
    "JoyAIImagePipeline": "diffsynth.pipelines.joyai_image",
    "Krea2Pipeline": "diffsynth.pipelines.krea2",
    "LTX2AudioVideoPipeline": "diffsynth.pipelines.ltx2_audio_video",
    "LingBotVideoPipeline": "diffsynth.pipelines.lingbot_video",
    "MiniMaxH3Pipeline": "diffsynth.pipelines.minimax_h3_audio_video",
    "MOSSImagePipeline": "diffsynth.pipelines.moss_image",
    "MovaAudioVideoPipeline": "diffsynth.pipelines.mova_audio_video",
    "QwenImagePipeline": "diffsynth.pipelines.qwen_image",
    "QwenImage21Pipeline": "diffsynth.pipelines.qwen_image_21",
    "QwenVideoEditPipeline": "diffsynth.pipelines.qwen_video_edit",
    "SenseNovaU1ImagePipeline": "diffsynth.pipelines.sensenova_u1_image",
    "StableDiffusionPipeline": "diffsynth.pipelines.stable_diffusion",
    "StableDiffusionXLPipeline": "diffsynth.pipelines.stable_diffusion_xl",
    "WanVideoPipeline": "diffsynth.pipelines.wan_video",
    "ZImagePipeline": "diffsynth.pipelines.z_image",
}

FIELD_LABELS = {
    "cfg_scale": "CFG Scale",
    "num_inference_steps": "Inference Steps",
}

OFFLOAD_MODEL_CONFIG = {
    "offload_dtype": {"$torch": "bfloat16"},
    "offload_device": "cpu",
    "onload_dtype": {"$torch": "bfloat16"},
    "onload_device": "cuda",
    "preparing_dtype": {"$torch": "bfloat16"},
    "preparing_device": "cuda",
    "computation_dtype": {"$torch": "bfloat16"},
    "computation_device": "cuda",
}

MINIMAX_OFFLOAD_MODEL_CONFIG = {
    **OFFLOAD_MODEL_CONFIG,
    "onload_device": "cpu",
}

MODEL_PROFILES = {
    "offload": OFFLOAD_MODEL_CONFIG,
    "minimax_offload": MINIMAX_OFFLOAD_MODEL_CONFIG,
    "offload_cpu": MINIMAX_OFFLOAD_MODEL_CONFIG,
}


def _field_label(name: str) -> str:
    return FIELD_LABELS.get(name, name.replace("_", " ").title())


def apply_model_config_overrides(
    model_configs: List[Dict[str, Any]], overrides: Optional[List[Dict[str, Any]]]
) -> List[Dict[str, Any]]:
    for entry in model_configs:
        model_config = entry.get("$model_config")
        if not isinstance(model_config, dict):
            continue
        target = str(model_config.get("origin_file_pattern") or model_config.get("path") or "")
        for override in overrides or []:
            pattern = str((override or {}).get("file_pattern") or "")
            if pattern and pattern in target:
                model_config.update({key: value for key, value in override.items() if key != "file_pattern"})
    return model_configs


def resolve_model_profile(name: Any) -> Dict[str, Any]:
    return MODEL_PROFILES.get(str(name or ""), {})


def build_sampling_model_configs(
    model_paths: List[Dict[str, Any]],
    model_profile: Optional[Dict[str, Any]] = None,
    overrides: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    model_profile = model_profile or {}
    model_configs: List[Dict[str, Any]] = []
    for item in model_paths:
        config: Dict[str, Any] = {}
        if item.get("local_path"):
            config["path"] = item["local_path"]
        elif item.get("model_id"):
            config["model_id"] = item["model_id"]
        if item.get("file_pattern"):
            config["origin_file_pattern"] = item["file_pattern"]
        if item.get("nf4"):
            excludes = [x.strip() for x in str(item.get("exclude_modules") or "").split(",") if x.strip()]
            config["quantize"] = {
                "$quantize_config": {"method": "bitsandbytes_nf4", "exclude_modules": excludes or None}
            }
        config.update(model_profile)
        model_configs.append({"$model_config": config})
    return apply_model_config_overrides(model_configs, overrides)


def rebuild_sampling_model_configs(
    pipeline: Dict[str, Any], model_paths: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    model_profile = resolve_model_profile(pipeline.get("model_profile"))
    overrides = pipeline.get("model_config_overrides")
    compact_models = pipeline.get("models")
    if compact_models is None:
        return build_sampling_model_configs(model_paths, model_profile, overrides)
    edits = {
        (str(item.get("model_id") or ""), str(item.get("file_pattern") or "")): item
        for item in model_paths
    }
    merged = [
        edits.get(
            (str(item[0]), str(item[1]) if len(item) > 1 else ""),
            {"model_id": item[0], "file_pattern": item[1] if len(item) > 1 else ""},
        )
        for item in compact_models
    ]
    return build_sampling_model_configs(merged, model_profile, overrides)


def _normalize_sampling(data: Dict[str, Any], defaults: Dict[str, Any], training_args: Dict[str, Any]) -> Dict[str, Any]:
    sampling = dict(data.get("sampling") or {})
    if not sampling:
        return {}
    pipeline = dict(sampling.get("pipeline") or {})
    class_name = str(pipeline.get("class") or "")
    module = str(pipeline.get("module") or PIPELINE_MODULES.get(class_name, ""))
    if not class_name or not module:
        return {}

    model_configs = rebuild_sampling_model_configs(pipeline, defaults.get("model_paths") or [])
    compact_configs = {
        key: (
            None
            if value is None
            else {
                "$model_config": {
                    "model_id": value[0],
                    **({"origin_file_pattern": value[1]} if len(value) > 1 and value[1] else {}),
                }
            }
        )
        for key, value in (pipeline.get("configs") or {}).items()
    }
    from_pretrained = {
        "torch_dtype": {"$torch": str(pipeline.get("dtype") or "bfloat16")},
        "device": "cuda",
        "model_configs": model_configs,
        **compact_configs,
        **dict(pipeline.get("from_pretrained") or {}),
    }
    if pipeline.get("vram_reserve_gb") is not None:
        from_pretrained["vram_limit"] = {
            "$cuda_free_gb_minus": float(pipeline["vram_reserve_gb"])
        }
    lora_modules = pipeline.get("lora_modules") or [
        {"module": str(training_args.get("lora_base_model") or "dit"), "alpha": 1}
    ]
    pipeline.update(
        module=module,
        from_pretrained=from_pretrained,
        lora_modules=lora_modules,
        adapter=str(pipeline.get("adapter") or "generic"),
    )
    sampling["output_extension"] = str(
        sampling.get("output_extension")
        or {"image": ".jpg", "video": ".mp4", "audio": ".wav"}.get(data.get("generation_type"), "")
    )
    sampling["input_schema"] = [
        {
            "required": False,
            "multiple": False,
            **field,
            "label": str(field.get("label") or _field_label(str(field.get("name") or ""))),
        }
        for field in sampling.get("input_schema") or []
    ]
    sampling["pipeline"] = pipeline
    return sampling


@dataclass
class ModelPath:
    model_id: str = ""
    file_pattern: str = ""
    local_path: str = ""
    fp8: bool = False
    nf4: bool = False
    quant_method: str = ""
    exclude_modules: str = ""


@dataclass
class ModelRecipe:
    name: str
    label: str
    train_script: str
    config_path: str
    generation_type: str = "image"
    family: str = ""
    source_script: str = ""
    dataset_kind: str = "image"
    lora_base_model: str = "dit"
    remove_prefix: str = "pipe.dit."
    default_lora_target: str = ""
    default_model_paths: List[ModelPath] = field(default_factory=list)
    extra_defaults: Dict[str, Any] = field(default_factory=dict)
    default_data_file_keys: str = "image,video,audio,edit_image"
    extra_inputs_override: Optional[str] = None
    default_resolution_mode: Optional[str] = None
    default_max_pixels: Optional[int] = None
    default_height: Optional[int] = None
    default_width: Optional[int] = None
    default_num_frames: Optional[int] = None
    default_dataset_repeat: int = 1
    default_lr: float = 1e-4
    default_epochs: int = 1
    default_lora_rank: int = 32
    default_use_gradient_checkpointing: bool = False
    default_optimizer: str = "torch.optim.AdamW"
    fixed_training_args: Dict[str, Any] = field(default_factory=dict)
    default_enable_custom_lora_target: bool = False
    default_sample_prompts: List[str] = field(default_factory=list)
    sampling: Dict[str, Any] = field(default_factory=dict)
    disable_sections: List[str] = field(default_factory=list)
    additional_sections: List[str] = field(default_factory=list)
    training_stages: List[Dict[str, Any]] = field(default_factory=list, repr=False)
    dataset_repeat_stage_index: Optional[int] = None
    editable_stage_parameters: List[Dict[str, Any]] = field(default_factory=list)


def _load_recipe(path: Path) -> ModelRecipe:
    data = json.loads(path.read_text(encoding="utf-8"))
    family = str(data["family"])
    name = str(data["name"])
    defaults = data.get("defaults")
    training_args = data.get("training_args")
    stages = data.get("stages")
    sampling = _normalize_sampling(data, defaults, training_args)
    train_script = str(data["train_script"])
    source_script = str(data["source_script"])
    pipeline = sampling.get("pipeline")
    if sampling and (
        not isinstance(pipeline, dict)
        or not pipeline.get("module")
        or not pipeline.get("class")
    ):
        sampling = {}
    model_paths = [ModelPath(**item) for item in defaults["model_paths"]]
    generation_type = str(data.get("generation_type", "image"))
    managed_training_args = {
        "data_file_keys",
        "lora_base_model",
        "remove_prefix_in_ckpt",
        "use_gradient_checkpointing",
        "gradient_accumulation",
        "dataset_num_workers",
        "find_unused_parameters",
        "extra_inputs",
    }
    runtime_stages = [{**training_args, **stage} for stage in stages]
    dataset_repeat_stage_index = None
    if len(runtime_stages) > 1 and str(runtime_stages[0].get("task", "")).endswith(":data_process"):
        dataset_repeat_stage_index = 1
    default_dataset_repeat = defaults["dataset_repeat"]
    if dataset_repeat_stage_index is not None:
        default_dataset_repeat = runtime_stages[dataset_repeat_stage_index].get(
            "dataset_repeat", default_dataset_repeat
        )
    editable_stage_parameters = []
    for stage in runtime_stages:
        editable = {
            key: stage[key]
            for key in ("max_timestep_boundary", "min_timestep_boundary")
            if key in stage
        }
        editable_stage_parameters.append(editable)
    return ModelRecipe(
        name=name,
        label=name,
        train_script=train_script,
        config_path=str(path.relative_to(MODEL_CONFIG_ROOT.parents[0])),
        generation_type=generation_type,
        family=family,
        source_script=source_script,
        dataset_kind={"image": "image", "video": "video", "audio": "audio"}[generation_type],
        lora_base_model=str(training_args.get("lora_base_model", "dit")),
        remove_prefix=str(training_args.get("remove_prefix_in_ckpt", "pipe.dit.")),
        default_lora_target=str(defaults["lora_target_modules"]),
        default_model_paths=model_paths,
        extra_defaults={
            key: value
            for key, value in training_args.items()
            if key not in managed_training_args
        },
        default_data_file_keys=(
            str(training_args["data_file_keys"])
            if training_args.get("data_file_keys")
            else None
        ),
        extra_inputs_override=(
            None if defaults.get("extra_inputs") is None
            else str(defaults["extra_inputs"])
        ),
        default_resolution_mode=(
            str(defaults["resolution_mode"])
            if defaults.get("resolution_mode") is not None else None
        ),
        default_max_pixels=(
            int(defaults["max_pixels"])
            if defaults.get("max_pixels") is not None else None
        ),
        default_height=(
            int(defaults["height"])
            if defaults.get("height") is not None else None
        ),
        default_width=(
            int(defaults["width"])
            if defaults.get("width") is not None else None
        ),
        default_num_frames=(
            int(defaults["num_frames"])
            if defaults.get("num_frames") is not None else None
        ),
        default_dataset_repeat=int(default_dataset_repeat),
        default_lr=float(defaults["learning_rate"]),
        default_epochs=int(defaults["num_epochs"]),
        default_lora_rank=int(defaults["lora_rank"]),
        default_use_gradient_checkpointing=bool(training_args.get("use_gradient_checkpointing", False)),
        default_optimizer=str(defaults["optimizer"]),
        fixed_training_args={
            key: value for key, value in training_args.items()
            if key in {"gradient_accumulation", "dataset_num_workers", "find_unused_parameters"}
        },
        default_enable_custom_lora_target=bool(defaults["enable_custom_lora_target"]),
        default_sample_prompts=[str(item) for item in sampling.get("sample_prompts") or []],
        sampling=dict(sampling),
        disable_sections=["resolution"] if generation_type == "audio" else [],
        additional_sections=["num_frames"] if defaults.get("num_frames") is not None else [],
        training_stages=runtime_stages,
        dataset_repeat_stage_index=dataset_repeat_stage_index,
        editable_stage_parameters=editable_stage_parameters,
    )


def _load_all() -> Dict[str, ModelRecipe]:
    recipes = [_load_recipe(path) for path in MODEL_CONFIG_ROOT.glob("*/*/default.json")]
    recipes.sort(key=lambda item: (item.family.casefold(), item.name.casefold()))
    result: Dict[str, ModelRecipe] = {}
    for recipe in recipes:
        if recipe.name in result:
            raise ValueError(f"Duplicate model config name: {recipe.name}")
        result[recipe.name] = recipe
    if not result:
        raise RuntimeError(f"No model configs found under {MODEL_CONFIG_ROOT}")
    return result


MODEL_RECIPES = _load_all()


def list_recipes() -> List[str]:
    return list(MODEL_RECIPES.keys())


def get_recipe(name: str) -> ModelRecipe:
    if name not in MODEL_RECIPES:
        raise KeyError(f"Unknown model type: {name}")
    return MODEL_RECIPES[name]


def get_default_config_path(name: str) -> Path:
    recipe = get_recipe(name)
    return MODEL_CONFIG_ROOT.parents[0] / recipe.config_path
