<div align="center">

# DiffSynth-WebUI

**Diffusion 模型可视化训练工作台**

数据集管理 · AI 自动标注 · 可视化训练配置 · 实时监控 · 训练后采样

基于 [DiffSynth-Studio](https://github.com/modelscope/DiffSynth-Studio) 构建

[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/node-20%2B-green)](https://nodejs.org/)
[![Discord](https://badgen.net//discord/members/Mm9suEeUDc)](https://discord.gg/Mm9suEeUDc)

[English](./README.md) · [简体中文](./README_zh.md)

</div>

<p align="center">
  <img src="https://github.com/user-attachments/assets/c3dfa4d9-e7da-47eb-976a-267100835251" alt="DiffSynth-WebUI" width="100%">
</p>

用浏览器完成 Diffusion LoRA 微调的完整流程：**不写训练脚本、不改 YAML、不用记命令行参数**。
每次运行的配置都会完整保存，可复现、可对比、可随时重跑。

## 功能特性

- **数据集管理** — 创建图像 / 视频 / 音频数据集，导入文件，维护 `metadata.jsonl` 与扩展字段
- **AI 自动标注** — 接入任意 OpenAI 兼容的多模态模型，批量生成或改写样本描述
- **可视化训练配置** — 按模型架构选择训练配方，配置 LoRA、分辨率、Epoch、优化器等
- **训练后采样** — 训练结束自动用最新 Checkpoint 生成样本，直接验证效果
- **实时监控** — 任务状态、启动命令、实时日志、Loss 曲线
- **产物管理** — 在线预览与下载 Checkpoint、样本、日志

<details>
<summary>界面预览</summary>

**数据集与自动标注**

![数据集页面与 AI 自动标注](https://github.com/user-attachments/assets/7b69a05c-0af1-4d07-ae48-68e2515787ba)

**样本扩展字段**

![为样本添加 edit_image 等扩展字段](https://github.com/user-attachments/assets/16ad71fd-c08d-4c9c-9be9-fb615a0269cb)
  

**训练配置**

![新建训练任务的配置页面](https://github.com/user-attachments/assets/b3399b0e-d623-4b67-a1af-20321a603a4c)

**训练任务监控**

![查看训练loss曲线和保存结果](https://github.com/user-attachments/assets/b7e3737b-934b-49f0-bd54-bec0e4f76395)

</details>

## 快速开始

### 安装

> **前置要求**：Node.js ≥ 20（用于构建 Web 前端，可用 `node -v` 检查）

```bash
git clone --recurse-submodules https://github.com/modelscope/DiffSynth-WebUI.git
cd DiffSynth-WebUI
bash setup.sh
```

### 启动 WebUI

Linux：

```bash
bash training_ui/launch.sh
```

Windows：
```powershell
powershell -ExecutionPolicy Bypass -File .\training_ui\launch_windows.ps1
```

首次启动时，脚本会在缺少 `node_modules` 时安装前端依赖，并构建 Next.js 前端。

默认访问地址：

```text
http://127.0.0.1:8100/dashboard
```

如需修改端口：

```bash
NEXT_PORT=9000 BACKEND_PORT=9001 bash training_ui/launch.sh
```

> 训练任务在独立进程中运行，**关闭浏览器或退出启动脚本都不会中断训练**，重新运行启动脚本即可继续查看任务状态。

### 快速跑通第一个 LoRA

1. **启动并打开** `http://127.0.0.1:8100/dashboard`
2. **Training Datasets → Create Dataset**，选 Image，导入几十张图片
3. 点 **Auto-Caption** 批量生成描述（需先在 Settings 里配置标注模型），或手动填写 Prompt
4. **New Task**：选模型 → 选 GPU → 选刚建的数据集 → 其余保持默认
5. 点 **Create Task**，进入任务详情页看日志与 Loss 曲线
6. 训练完成后在页面底部下载 `*.safetensors`并查看采样结果

完整选项说明见下方[使用指南](#使用指南)。

## 使用指南

推荐按以下顺序完成首次训练。

### 第一步：配置存储与运行选项

进入 **Settings** 页面，检查以下配置：

| 配置 | 说明 | 默认值 |
| --- | --- | --- |
| Dataset Directory | 数据集及其元数据的保存目录 | `training_ui/data/datasets` |
| Training Output Directory | 任务日志、Checkpoint 和样本的保存目录 | `training_ui/data/outputs` |
| Model Storage Directory | 下载模型的基础目录 | `models` |
| Model Download Source | 模型下载来源：ModelScope 或 Hugging Face | ModelScope |
| Attention Implementation | Attention 实现，留空表示自动选择 | 留空 |

如果需要自动生成数据描述，可在 **Captioning Models** 中添加多模态模型。

### 第二步：准备数据集

进入 **Datasets** 页面：

1. 输入数据集名称
2. 选择 Image、Video 或 Audio 类型
3. 点击 **Create Dataset**
4. 打开数据集并导入样本文件，支持导入形式：
    - 单文件
    - 多文件
    - 压缩包（与媒体文件同名的 `.txt` 会自动作为 Prompt 导入）
5. 为每条样本填写/编辑 Prompt，或使用 **Auto-Caption** 生成描述
6. 按模型训练需要对每个样本依次添加 `edit_image` 或其他扩展字段

> 磁盘上的目录结构见[数据集格式](#数据集格式)。

### 第三步：创建训练任务

进入 **Tasks**，点击 **New Task**：

1. **Task Information**：填写任务名称并选择 GPU
2. **Model**：选择 Model Architecture 和 Target Model
3. **Model Paths**：使用默认模型仓库，或填写本地模型路径；部分模型可以启用 FP8
4. **LoRA Settings**：选择默认 LoRA 目标模块，或启用自定义目标并设置 Rank
5. **Dataset**：选择数据集、重复次数和分辨率
6. **Training**：设置 Epochs、Learning Rate、Optimizer；需要时填写恢复训练的 Checkpoint
7. **Sampling**：为支持训练后采样的模型添加 Prompt 和其他输入条件
8. 查看 **Launch Command**，确认最终命令后创建任务

分辨率支持两种模式：

- `max_pixels`：使用输入高宽的乘积限制总像素数，例如 `1024 * 1024 = 1048576 px`。
- `height × width`：固定训练输入的高和宽。

创建任务时可以选择立即启动，也可以保存后在任务列表中手动启动。同一个任务可以多次运行，每次运行会创建独立的输出目录。

### 第四步：监控训练

打开任务详情页，可以查看：

- 当前状态与运行时间
- 实际启动命令和完整任务配置
- 实时训练日志
- Loss 曲线
- 当前运行生成的 Checkpoint、最终样本和其他文件

训练运行中可以手动停止任务；停止后可以修改配置并重新启动

### 第五步：使用训练产物

默认输出结构如下：

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

- `training_config.json`：本次运行的用户配置、解析结果和实际命令
- `train.log`：训练标准输出和错误日志
- `loss.csv`：按 `step,key,value` 保存训练指标
- `*.safetensors`：训练得到的模型文件
- `final_samples/`：训练完成后生成的验证样本

## 数据集格式

每个数据集是 `Dataset Directory` 下的一个独立目录。扩展字段的文件统一存放在 `_fields/` 中，
由界面自动管理：

```text
training_ui/data/datasets/<dataset-name>/
├── metadata.jsonl
├── 001.jpg
├── 002.jpg
└── _fields/
    └── 002/                          # 样本名（不含扩展名）
        └── edit_image/               # 扩展字段名
            └── input_image.jpg
```

metadata.jsonl 每行一条样本：
```text
{"file": "001.jpg", "prompt": "a cat sitting on a sofa"}
{"file": "002.jpg", "prompt": "make the sofa red", "edit_image": "_fields/002/edit_image/input_image.jpg"}
```

**无需手动裁剪或缩放** —— 训练时会按配置的分辨率自动处理

## 支持的模型系列

### 图像生成模型
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

### 视频生成模型
- LingBot-Video
- LTX-2
- MiniMax-H3
- MOVA
- Wan

### 音频生成模型
- ACE-Step

> 模型本身的能力、显存需求与训练技巧请参考 [DiffSynth-Studio 文档](https://diffsynth-studio-doc.readthedocs.io/zh-cn/latest/)


## 关于 DiffSynth-Studio

DiffSynth-WebUI 与 [DiffSynth-Studio](https://github.com/modelscope/DiffSynth-Studio) 由同一团队维护：
Studio 负责模型实现与训练框架，WebUI 负责把整套训练流程搬进浏览器。
如果你更习惯命令行和 Python 脚本，直接使用 DiffSynth-Studio 即可。

本仓库已包含完整的 DiffSynth-Studio 代码，上游更新会持续同步合并，**安装本仓库即可，无需另外安装**。
