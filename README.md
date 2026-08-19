<div align="center">

# DiffSynth-WebUI

**A Visual Training Workbench for Diffusion Models**

Dataset Management · AI Auto-Captioning · Visual Training Configuration · Live Monitoring · Post-Training Sampling

Built on [DiffSynth-Studio](https://github.com/modelscope/DiffSynth-Studio)

[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/node-20%2B-green)](https://nodejs.org/)
[![Discord](https://badgen.net//discord/members/Mm9suEeUDc)](https://discord.gg/Mm9suEeUDc)

[English](./README.md) · [简体中文](./README_zh.md)

</div>

<p align="center">
  <img src="https://github.com/user-attachments/assets/c3dfa4d9-e7da-47eb-976a-267100835251" alt="DiffSynth-WebUI" width="100%">
</p>

Run the entire diffusion LoRA fine-tuning workflow from your browser: **no training scripts, no YAML to edit, no command-line flags to memorize.**
Every run's configuration is saved in full, so results are reproducible, comparable, and can be re-run at any time.

## Features

- **Dataset management** — Create image / video / audio datasets, import files, and maintain `metadata.jsonl` along with extra fields
- **AI auto-captioning** — Connect any OpenAI-compatible multimodal model to generate or rewrite sample captions in bulk
- **Visual training configuration** — Pick a training recipe by model architecture, then configure LoRA, resolution, epochs, optimizer, and more
- **Post-training sampling** — Automatically generate samples with the latest checkpoint when training finishes, so you can verify results right away
- **Live monitoring** — Task status, launch command, streaming training logs, and loss curves
- **Artifact management** — Preview and download checkpoints, samples, and logs in the browser

<details>
<summary>Screenshots</summary>

**Datasets and auto-captioning**

![Dataset page with AI auto-captioning](https://github.com/user-attachments/assets/7b69a05c-0af1-4d07-ae48-68e2515787ba)

**Sample extra fields**

![Adding extra fields such as edit_image to a sample](https://github.com/user-attachments/assets/16ad71fd-c08d-4c9c-9be9-fb615a0269cb)

**Training configuration**

![Configuration page for creating a new training task](https://github.com/user-attachments/assets/b3399b0e-d623-4b67-a1af-20321a603a4c)

**Task monitoring**

![Viewing the training loss curve and saved artifacts](https://github.com/user-attachments/assets/b7e3737b-934b-49f0-bd54-bec0e4f76395)

</details>

## Getting Started

### Installation

> **Prerequisite**: Node.js ≥ 20 (used to build the web frontend; check with `node -v`)

```bash
git clone --recurse-submodules https://github.com/modelscope/DiffSynth-WebUI.git
cd DiffSynth-WebUI
bash setup.sh
```

### Launching the WebUI

Linux:

```bash
bash training_ui/launch.sh
```

Windows:
```powershell
powershell -ExecutionPolicy Bypass -File .\training_ui\launch_windows.ps1
```

On first launch, the script installs the frontend dependencies if `node_modules` is missing, then builds the Next.js frontend.

Default URL:

```text
http://127.0.0.1:8100/dashboard
```

To use different ports:

```bash
NEXT_PORT=9000 BACKEND_PORT=9001 bash training_ui/launch.sh
```

> Training runs in a separate process, so **closing the browser or exiting the launch script will not interrupt training**. Just run the launch script again to resume monitoring task status.

### Train Your First LoRA

1. **Launch and open** `http://127.0.0.1:8100/dashboard`
2. **Training Datasets → Create Dataset**, choose Image, and import a few dozen images
3. Click **Auto-Caption** to generate captions in bulk (configure a captioning model in Settings first), or write prompts by hand
4. **New Task**: pick a model → pick a GPU → pick the dataset you just created → leave everything else at its default
5. Click **Create Task**, then open the task detail page to watch the logs and loss curve
6. When training finishes, download `*.safetensors` at the bottom of the page and review the sampling results

See the [Usage Guide](#usage-guide) below for a full description of every option.

## Usage Guide

For your first training run, we recommend going through the steps in order.

### Step 1: Configure Storage and Runtime Options

Open the **Settings** page and review the following:

| Setting | Description | Default |
| --- | --- | --- |
| Dataset Directory | Where datasets and their metadata are stored | `training_ui/data/datasets` |
| Training Output Directory | Where task logs, checkpoints, and samples are stored | `training_ui/data/outputs` |
| Model Storage Directory | Base directory for downloaded models | `models` |
| Model Download Source | Where models are downloaded from: ModelScope or Hugging Face | ModelScope |
| Attention Implementation | Attention implementation; leave blank to select automatically | Blank |

To generate captions automatically, add a multimodal model under **Captioning Models**.

### Step 2: Prepare a Dataset

Open the **Datasets** page:

1. Enter a dataset name
2. Choose the Image, Video, or Audio type
3. Click **Create Dataset**
4. Open the dataset and import your sample files. Supported import methods:
    - Single file
    - Multiple files
    - Archive (a `.txt` file with the same name as a media file is imported as its prompt)
5. Write or edit the prompt for each sample, or use **Auto-Caption** to generate captions
6. Add extra fields such as `edit_image` to each sample as required by the model you are training

> See [Dataset Format](#dataset-format) for the on-disk directory layout.

### Step 3: Create a Training Task

Open **Tasks** and click **New Task**:

1. **Task Information** — Enter a task name and select a GPU
2. **Model** — Choose the Model Architecture and Target Model
3. **Model Paths** — Use the default model repositories, or enter local model paths; FP8 can be enabled for some models
4. **LoRA Settings** — Use the default LoRA target modules, or enable custom targets and set the rank
5. **Dataset** — Choose the dataset, repeat count, and resolution
6. **Training** — Set epochs, learning rate, and optimizer; enter a checkpoint if you want to resume training
7. **Sampling** — For models that support post-training sampling, add prompts and any other input conditions
8. Review the **Launch Command**, and create the task once the final command looks right

Resolution supports two modes:

- `max_pixels`: caps the total pixel count as the product of input height and width, e.g. `1024 * 1024 = 1048576 px`.
- `height × width`: fixes the exact height and width of the training input.

You can start the task immediately when creating it, or save it and start it manually from the task list later. A task can be run multiple times, and each run creates its own output directory.

### Step 4: Monitor Training

The task detail page shows:

- Current status and elapsed time
- The actual launch command and the full task configuration
- Streaming training logs
- The loss curve
- Checkpoints, final samples, and other files produced by the current run

You can stop a task manually while it is running; after stopping, you can adjust its configuration and start it again.

### Step 5: Use the Training Artifacts

The default output layout:

```text
training_ui/data/outputs/
└── <task-id>_<task-name>/
    └── <run-timestamp>/
        ├── training_config.json
        ├── train.log
        ├── loss.csv
        ├── step-*.safetensors
        └── final_samples/
```

- `training_config.json`: the user configuration, resolved settings, and actual command for this run
- `train.log`: training stdout and stderr
- `loss.csv`: training metrics stored as `step,key,value`
- `*.safetensors`: the trained model files
- `final_samples/`: validation samples generated after training finishes

## Dataset Format

Each dataset is a self-contained directory under `Dataset Directory`. Files belonging to extra fields are all kept under `_fields/`,
which the UI manages for you:

```text
training_ui/data/datasets/<dataset-name>/
├── metadata.jsonl
├── 001.jpg
├── 002.jpg
└── _fields/
    └── 002/                          # sample name (without extension)
        └── edit_image/               # extra field name
            └── input_image.jpg
```

One sample per line in `metadata.jsonl`:
```text
{"file": "001.jpg", "prompt": "a cat sitting on a sofa"}
{"file": "002.jpg", "prompt": "make the sofa red", "edit_image": "_fields/002/edit_image/input_image.jpg"}
```

**No manual cropping or resizing required** — samples are processed automatically at the configured resolution during training.

## Supported Model Families

### Image Generation
- Anima
- Boogu-Image
- ERNIE-Image
- FLUX.1
- FLUX.2
- HiDream-O1-Image
- Ideogram 4
- JoyAI-Image
- Krea 2
- Qwen-Image
- Stable Diffusion
- Stable Diffusion XL
- Z-Image

### Video Generation
- LingBot-Video
- LTX-2
- MiniMax-H3
- MOVA
- Wan

### Audio Generation
- ACE-Step

> For each model's capabilities, VRAM requirements, and training tips, see the [DiffSynth-Studio documentation](https://diffsynth-studio-doc.readthedocs.io/en/latest/).

## About DiffSynth-Studio

DiffSynth-WebUI and [DiffSynth-Studio](https://github.com/modelscope/DiffSynth-Studio) are maintained by the same team:
Studio provides the model implementations and the training framework, while the WebUI brings the whole training workflow into the browser.
If you are more comfortable with the command line and Python scripts, use DiffSynth-Studio directly.

This repository already contains the full DiffSynth-Studio codebase and keeps merging upstream updates, so **installing this repository is all you need — there is no need to install DiffSynth-Studio separately**.
