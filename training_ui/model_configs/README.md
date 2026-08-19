# Training Model Configurations

This directory is the runtime source of truth for models exposed by the training UI.

Directory layout:

```text
model_configs/<examples-family>/<training-model>/default.json
```

For example:

```text
model_configs/flux2/FLUX.2-klein-base-4B/default.json
```

Each config has four parameter layers:

- `defaults` explicitly contains every model-dependent value editable in the task form;
- `training_args` contains fixed arguments shared by all training stages, including
  `gradient_accumulation`, `dataset_num_workers`, `find_unused_parameters`, and
  `extra_inputs`;
- `stages` contains only per-stage overrides and is usually `[{}]` for a single-stage model;
- `sampling` contains the direct pipeline class, model-specific inputs, and optional
  prompt defaults. Output extension, pipeline module, model paths, and the default
  LoRA module are inferred from the rest of the model config. Use `pipeline.models`,
  `pipeline.configs`, `pipeline.lora_modules`, or `pipeline.adapter` only when a
  sampling pipeline differs from those defaults.

The UI does not expose or store `gradient_accumulation`, `dataset_num_workers`,
`find_unused_parameters`, `extra_inputs`, `trigger_word`, `seed`, or `save_every`.
Keep `dataset_num_workers` in `training_args` because several supported example
scripts explicitly set it to `8`; models that omit it use the parser default `0`.

`num_frames` is present only for video models. Image and audio configs omit it.

`family` and `name` are explicit and must match the directory path. Configs do not
use a `schema_version` field. Dataset paths and `output_path` are task-specific and
must not be stored in a model default config.

Defaults explicitly present in an example shell use the shell value. Missing form
values use the defaults declared by the corresponding `train.py` parser in
`diffsynth/diffusion/parsers.py`. Runtime code reads these values directly instead
of deriving form defaults from the first stage.

Runtime code reads these JSON files directly and does not parse shell scripts.
