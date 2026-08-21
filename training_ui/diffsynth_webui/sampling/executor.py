from __future__ import annotations

import importlib
import inspect
from pathlib import Path
from typing import Any, Dict, Iterable, List


def _decode(value: Any) -> Any:
    if isinstance(value, list):
        return [_decode(item) for item in value]
    if not isinstance(value, dict):
        return value
    if set(value) == {"$torch"}:
        import torch
        return getattr(torch, str(value["$torch"]))
    if set(value) == {"$cuda_free_gb_minus"}:
        import torch
        try:
            free, _ = torch.cuda.mem_get_info("cuda")
        except (RuntimeError, NotImplementedError):
            free = torch.cuda.get_device_properties("cuda").total_memory - torch.cuda.memory_reserved("cuda")
        return free / (1024 ** 3) - float(value["$cuda_free_gb_minus"])
    if set(value) == {"$model_config"}:
        from diffsynth import ModelConfig
        return ModelConfig(**_decode(value["$model_config"]))
    if set(value) == {"$quantize_config"}:
        from diffsynth import QuantizeConfig
        return QuantizeConfig(**_decode(value["$quantize_config"]))
    return {key: _decode(item) for key, item in value.items()}


def build_pipeline(spec: Dict[str, Any], checkpoint: Path) -> Any:
    module = importlib.import_module(str(spec["module"]))
    pipeline_class = getattr(module, str(spec["class"]))
    pipe = pipeline_class.from_pretrained(**_decode(spec.get("from_pretrained") or {}))
    for item in spec.get("lora_modules") or []:
        target = getattr(pipe, str(item["module"]))
        pipe.load_lora(target, str(checkpoint), alpha=float(item.get("alpha", 1.0)))
    return pipe


def _prepare_image(path: str, preprocess: Any, height: int | None, width: int | None):
    from PIL import Image
    image = Image.open(path)
    if preprocess == "resize":
        if height is None or width is None:
            raise ValueError("image resize preprocessing requires height and width")
        image = image.resize((int(width), int(height)))
    return image


def _video(path: str, height: int | None, width: int | None) -> List[Any]:
    from diffsynth.utils.data import VideoData
    return VideoData(path, height=height, width=width).raw_data()


def _media_value(name: str, field: Dict[str, Any], value: Any, height: int | None, width: int | None) -> Any:
    field_type = str(field.get("type") or "")
    values = value if isinstance(value, list) else [value]
    size_scale = float(field.get("size_scale", 1.0))
    media_height = int(height * size_scale) if height is not None else None
    media_width = int(width * size_scale) if width is not None else None
    if field_type == "image":
        loaded = [
            _prepare_image(str(path), field.get("preprocess"), media_height, media_width)
            for path in values
        ]
    elif field_type == "video":
        loaded = [_video(str(path), media_height, media_width) for path in values]
        if name in {"input_image", "reference_image", "vace_reference_image", "image"}:
            loaded = [frames[0] for frames in loaded]
    elif field_type == "audio":
        return value
    else:
        return value
    return loaded if field.get("multiple") else loaded[0]


def _controlnet_input(spec: Dict[str, Any], inputs: Dict[str, Any]):
    from diffsynth.diffusion.base_pipeline import ControlNetInput
    image = inputs.pop("image", None)
    mask = inputs.pop("inpaint_mask", None)
    controlnet = dict(spec.get("controlnet") or {})
    kwargs: Dict[str, Any] = {
        "image": image,
        "scale": float(controlnet.get("scale", 1.0)),
    }
    if mask is not None:
        kwargs[str(controlnet.get("mask_argument") or "inpaint_mask")] = mask
    if controlnet.get("processor_id"):
        kwargs["processor_id"] = str(controlnet["processor_id"])
    return [ControlNetInput(**kwargs)]


def prepare_inputs(
    model_type: str,
    spec: Dict[str, Any],
    input_schema: Iterable[Dict[str, Any]],
    prompt: str,
    raw_inputs: Dict[str, Any],
) -> Dict[str, Any]:
    height = raw_inputs.get("height")
    width = raw_inputs.get("width")
    values: Dict[str, Any] = {
        **dict(spec.get("call_defaults") or {}),
        "prompt": prompt,
    }
    for field in input_schema:
        name = str(field.get("name") or "")
        value = raw_inputs.get(name)
        if value is None or value == "" or value == []:
            continue
        values[name] = _media_value(name, field, value, height, width)

    adapter = str(spec.get("adapter") or "generic")
    if adapter == "controlnet" or model_type == "FLUX.1-dev-InfiniteYou":
        # Recipe adapters translate generic UI fields into each pipeline's call signature.
        key = "blockwise_controlnet_inputs" if spec.get("class") == "QwenImagePipeline" else "controlnet_inputs"
        values[key] = _controlnet_input(spec, values)
    if spec.get("class") == "LTX2AudioVideoPipeline" and "image" in values:
        values["input_images"] = [values.pop("image")]
        values["input_images_indexes"] = [0]
    if adapter == "ltx_ic_lora":
        values["in_context_videos"] = [values.pop("input_video")]
        values["in_context_downsample_factor"] = 2
    if adapter == "minimax_fl2va":
        frames = values.pop("keyframe_video")
        values["keyframes"] = [frames[0], frames[-1]]
        values["keyframe_indices"] = [0, -1]
    if adapter == "minimax_ref2va":
        values["references"] = [{"type": "image", "image": values.pop("reference_image")}]
    if adapter == "wan_s2v":
        import librosa
        audio_path = str(values.pop("audio_path"))
        values["input_audio"], values["audio_sample_rate"] = librosa.load(audio_path, sr=16000)
        values["s2v_pose_video"] = values.pop("pose_video_path")
    if model_type == "Video-As-Prompt-Wan2.1-14B":
        values["vap_video"] = values.pop("ref_video_path")
        values["input_image"] = values.pop("target_image_path")
    if "Wan" in model_type and "video" in values:
        frames = values.pop("video")
        values["input_image"] = frames[0]
        if "InP" in model_type or "FLF2V" in model_type:
            values["end_image"] = frames[-1]
    signature = inspect.signature(type_spec_call(spec))
    return {key: value for key, value in values.items() if key in signature.parameters}


def type_spec_call(spec: Dict[str, Any]):
    module = importlib.import_module(str(spec["module"]))
    return getattr(module, str(spec["class"])).__call__


def save_output(
    pipe: Any,
    spec: Dict[str, Any],
    result: Any,
    output: Path,
    source_inputs: Dict[str, Any],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    suffix = output.suffix.casefold()
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        image = result[0] if isinstance(result, (list, tuple)) else result
        image.save(output)
        return
    if suffix == ".wav":
        from diffsynth.utils.data.audio import save_audio
        rate = getattr(getattr(pipe, "vae", None), "sampling_rate", 48000)
        save_audio(result, rate, str(output))
        return
    if suffix == ".mp4":
        output_fps = float(spec.get("output_fps", 15))
        if isinstance(result, tuple) and len(result) == 2 and pipe.__class__.__name__ == "MiniMaxH3Pipeline":
            from diffsynth.utils.data.audio_video import write_video_audio
            write_video_audio(
                video=result[0], audio=result[1], output_path=str(output),
                fps=output_fps, audio_sample_rate=pipe.audio_vae.sample_rate,
            )
        elif isinstance(result, tuple) and len(result) == 2:
            from diffsynth.utils.data.media_io_ltx2 import write_video_audio_ltx2
            rate = getattr(getattr(pipe, "audio_vocoder", None), "output_sampling_rate", 48000)
            write_video_audio_ltx2(result[0], result[1], str(output), fps=output_fps, audio_sample_rate=rate)
        elif spec.get("output_audio_input"):
            from diffsynth.utils.data import save_video_with_audio
            frames = result[1:] if spec.get("output_drop_first_frame") else result
            audio_path = str(source_inputs[str(spec["output_audio_input"])])
            save_video_with_audio(frames, str(output), audio_path, fps=output_fps, quality=5)
        else:
            from diffsynth.utils.data import save_video
            save_video(result, str(output), fps=output_fps, quality=5)
        return
    raise ValueError(f"Unsupported sampling output extension: {suffix}")


def run_sample(
    pipe: Any,
    model_type: str,
    spec: Dict[str, Any],
    input_schema: List[Dict[str, Any]],
    prompt: str,
    inputs: Dict[str, Any],
    output: Path,
) -> None:
    kwargs = prepare_inputs(model_type, spec, input_schema, prompt, inputs)
    result = pipe(**kwargs)
    save_output(pipe, spec, result, output, inputs)
