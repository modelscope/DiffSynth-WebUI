"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { formatShellCommand } from "@/lib/format";
import { Button, Card, Field, PageHeader } from "@/components/ui";

type ModelPath = { model_id: string; file_pattern: string; local_path: string; fp8: boolean };
type StageParameters = {
  max_timestep_boundary?: number;
  min_timestep_boundary?: number;
};
type SamplingInputValue = { files: File[]; paths: string[]; value?: any };
type SamplingRow = {
  id: string;
  prompt: string;
  inputs: Record<string, SamplingInputValue>;
};

function newSamplingId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function samplingInputsFor(recipe: any): Record<string, SamplingInputValue> {
  return Object.fromEntries(
    (recipe?.sampling?.input_schema || [])
      .filter((field: any) => field.default !== undefined)
      .map((field: any) => [field.name, { files: [], paths: [], value: field.default }]),
  );
}

function squareResolutionForPixels(pixels: number) {
  const side = Math.max(1, Math.floor(Math.sqrt(Number(pixels) || 1048576)));
  return { height: side, width: side };
}

function createSamplingRow(recipe: any, prompt = ""): SamplingRow {
  return { id: newSamplingId(), prompt, inputs: samplingInputsFor(recipe) };
}

const OPTIMIZERS = ["torch.optim.AdamW", "bitsandbytes.optim.Adam8bit"];
const DATASET_KIND_LABELS: Record<string, string> = {
  image: "Image",
  edit: "Image Editing",
  video: "Video",
  audio: "Audio",
};

const MODEL_FAMILY_LABELS: Record<string, string> = {
  ace_step: "ACE-Step",
  anima: "Anima",
  boogu_image: "Boogu-Image",
  ernie_image: "ERNIE-Image",
  flux: "FLUX.1",
  flux2: "FLUX.2",
  hidream_o1_image: "HiDream-O1-Image",
  ideogram4: "Ideogram 4",
  joyai_image: "JoyAI-Image",
  krea2: "Krea-2",
  lingbot_video: "LingBot-Video",
  ltx2: "LTX-2",
  minimax_h3: "MiniMax-H3",
  mova: "MOVA",
  qwen_image: "Qwen-Image",
  stable_diffusion: "Stable Diffusion",
  stable_diffusion_xl: "Stable Diffusion XL",
  wanvideo: "Wan",
  z_image: "Z-Image",
};

function modelFamilyLabel(family: string): string {
  return MODEL_FAMILY_LABELS[family] || family;
}

function resolvedStageParameters(recipe: any, configured?: any[]): StageParameters[] {
  return (recipe?.editable_stage_parameters || []).map((stage: any, index: number) => {
    const saved = configured?.[index] || {};
    const result: StageParameters = {};
    if (stage.max_timestep_boundary !== undefined) {
      result.max_timestep_boundary = Number(
        saved.max_timestep_boundary ?? stage.max_timestep_boundary,
      );
    }
    if (stage.min_timestep_boundary !== undefined) {
      result.min_timestep_boundary = Number(
        saved.min_timestep_boundary ?? stage.min_timestep_boundary,
      );
    }
    return result;
  });
}

export default function NewTaskPage() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<any[]>([]);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [gpus, setGpus] = useState<any[]>([]);
  const [editTaskId, setEditTaskId] = useState("");
  const [loadedEditTaskId, setLoadedEditTaskId] = useState("");

  const [name, setName] = useState("");
  const [gpuIndex, setGpuIndex] = useState<string>("");
  const [modelFamily, setModelFamily] = useState<string>("");
  const [modelType, setModelType] = useState<string>("");
  const [modelPaths, setModelPaths] = useState<ModelPath[]>([]);
  const [enableCustomLoraTarget, setEnableCustomLoraTarget] = useState(false);
  const [loraTargetModules, setLoraTargetModules] = useState("");
  const [loraRank, setLoraRank] = useState<number | "">(32);
  const [dataset, setDataset] = useState<string>("");
  const [datasetRepeat, setDatasetRepeat] = useState<number | "">(1);
  const [resolutionMode, setResolutionMode] = useState<"max_pixels" | "hw">("max_pixels");
  const [maxPixels, setMaxPixels] = useState(1048576);
  const [maxPixelHeight, setMaxPixelHeight] = useState<number | "">(1024);
  const [maxPixelWidth, setMaxPixelWidth] = useState<number | "">(1024);
  const [height, setHeight] = useState<number | "">(1024);
  const [width, setWidth] = useState<number | "">(1024);
  const [numFrames, setNumFrames] = useState<number | "">("");
  const [numEpochs, setNumEpochs] = useState<number | "">(5);
  const [learningRate, setLearningRate] = useState<number | "">(1e-4);
  const [optimizer, setOptimizer] = useState(OPTIMIZERS[0]);
  const [resumeFromCheckpoint, setResumeFromCheckpoint] = useState("");
  const [samplingRows, setSamplingRows] = useState<SamplingRow[]>([]);
  const [startNow, setStartNow] = useState(true);

  const [stageParameters, setStageParameters] = useState<StageParameters[]>([]);

  const [previewCmd, setPreviewCmd] = useState<string[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.recipes().then((r) => setRecipes(r.recipes || []));
    api.listDatasets(1, 1000).then((r) => setDatasets(r.datasets || []));
    api.gpu().then((r) => setGpus(r.gpus || []));
    setEditTaskId(new URLSearchParams(window.location.search).get("edit") || "");
  }, []);

  useEffect(() => {
    if (!editTaskId || loadedEditTaskId === editTaskId || recipes.length === 0) return;
    api.getTask(editTaskId)
      .then((task) => {
        const cfg = task.config || {};
        const recipe = recipes.find((item) => item.name === cfg.model_type);
        setName(task.name || "");
        setGpuIndex(String(cfg.gpu_index ?? 0));
        setModelFamily(recipe?.family || "");
        setModelType(cfg.model_type || "");
        setModelPaths(cfg.model_paths || []);
        setEnableCustomLoraTarget(!!cfg.enable_custom_lora_target);
        setLoraTargetModules(cfg.lora_target_modules || "");
        setLoraRank(cfg.lora_rank ?? 32);
        setDataset(cfg.dataset || "");
        setDatasetRepeat(cfg.dataset_repeat ?? 50);
        setResolutionMode(cfg.resolution_mode || "max_pixels");
        const loadedMaxPixels = cfg.max_pixels ?? 1048576;
        setMaxPixels(loadedMaxPixels);
        const loadedMaxResolution = squareResolutionForPixels(loadedMaxPixels);
        setMaxPixelHeight(loadedMaxResolution.height);
        setMaxPixelWidth(loadedMaxResolution.width);
        setHeight(cfg.height ?? "");
        setWidth(cfg.width ?? "");
        setNumFrames(cfg.num_frames ?? "");
        setNumEpochs(cfg.num_epochs ?? 5);
        setLearningRate(cfg.learning_rate ?? 1e-4);
        setOptimizer(cfg.optimizer || OPTIMIZERS[0]);
        setResumeFromCheckpoint(cfg.resume_from_checkpoint || "");
        const storedSamples = Array.isArray(cfg.samples)
          ? cfg.samples
          : (cfg.sample_prompts || []).map((prompt: string) => ({ prompt, inputs: {} }));
        setSamplingRows(storedSamples.map((sample: any) => ({
          id: String(sample.id || newSamplingId()),
          prompt: String(sample.prompt || ""),
          inputs: { ...samplingInputsFor(recipe), ...Object.fromEntries(
            Object.entries(sample.inputs || {}).map(([key, value]) => [
              key,
              ["image", "video", "audio"].includes(
                recipe?.sampling?.input_schema?.find((field: any) => field.name === key)?.type,
              )
                ? { files: [], paths: Array.isArray(value) ? value.map(String) : value ? [String(value)] : [] }
                : { files: [], paths: [], value },
            ]),
          ) },
        })));
        setStageParameters(
          resolvedStageParameters(
            recipe,
            Array.isArray(cfg.stage_parameters) ? cfg.stage_parameters : undefined,
          ),
        );
        setStartNow(false);
        setLoadedEditTaskId(editTaskId);
      })
      .catch((error) => setMsg("Failed to load task: " + error.message));
  }, [editTaskId, loadedEditTaskId, recipes]);

  const currentRecipe = useMemo(
    () => recipes.find((r) => r.name === modelType),
    [recipes, modelType],
  );
  const computedMaxPixels = maxPixelHeight === "" || maxPixelWidth === ""
    ? null
    : Number(maxPixelHeight) * Number(maxPixelWidth);
  const modelFamilies = useMemo(
    () => Array.from(new Set(recipes.map((recipe) => recipe.family))).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" })),
    [recipes],
  );
  const familyRecipes = useMemo(
    () => recipes
      .filter((recipe) => recipe.family === modelFamily)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" })),
    [recipes, modelFamily],
  );

  function selectFamily(family: string) {
    setModelFamily(family);
    setModelType("");
    setModelPaths([]);
    setStageParameters([]);
    setSamplingRows([]);
  }

  async function randomDatasetPrompt(datasetName = dataset): Promise<string> {
    if (!datasetName) return "";
    try {
      const detail = await api.datasetDetail(datasetName);
      const prompts = (detail.metadata || [])
        .map((item: any) => String(item?.prompt || "").trim())
        .filter(Boolean);
      return prompts.length > 0
        ? prompts[Math.floor(Math.random() * prompts.length)]
        : "";
    } catch {
      return "";
    }
  }

  async function applyRecipe(name: string) {
    setModelType(name);
    const r = recipes.find((x) => x.name === name);
    if (!r) return;
    setModelPaths(
      (r.default_model_paths || []).map((mp: any) => ({
        model_id: mp.model_id || "",
        file_pattern: mp.file_pattern || "",
        local_path: mp.local_path || "",
        fp8: !!mp.fp8,
      })),
    );
    setLoraTargetModules(r.default_lora_target || "");
    setEnableCustomLoraTarget(!!r.default_enable_custom_lora_target);
    setLoraRank(r.default_lora_rank || 32);
    setResolutionMode(r.default_resolution_mode || "max_pixels");
    const defaultMaxPixels = r.default_max_pixels || 1048576;
    setMaxPixels(defaultMaxPixels);
    const defaultMaxResolution = squareResolutionForPixels(defaultMaxPixels);
    setMaxPixelHeight(defaultMaxResolution.height);
    setMaxPixelWidth(defaultMaxResolution.width);
    setHeight(r.default_height ?? "");
    setWidth(r.default_width ?? "");
    setNumFrames(r.default_num_frames ?? "");
    setNumEpochs(r.default_epochs || 5);
    setLearningRate(r.default_lr || 1e-4);
    setDatasetRepeat(r.default_dataset_repeat || 1);
    setOptimizer(r.default_optimizer || OPTIMIZERS[0]);
    setResumeFromCheckpoint("");
    const canSample = Boolean(r.sampling?.pipeline);
    const hasMediaInput = (r.sampling?.input_schema || []).some((field: any) => ["image", "video", "audio"].includes(field.type));
    if (!canSample) setSamplingRows([]);
    else if (hasMediaInput) setSamplingRows([]);
    else setSamplingRows([createSamplingRow(r, await randomDatasetPrompt())]);
    setStageParameters(resolvedStageParameters(r));
  }

  function serializedSamples(): any[] {
    return samplingRows.map((sample) => ({
      id: sample.id,
      prompt: sample.prompt.trim(),
      inputs: Object.fromEntries(
        Object.entries(sample.inputs)
          .filter(([, value]) => value.paths.length > 0 || value.value !== undefined)
          .map(([key, value]) => [key, value.paths.length > 0 ? value.paths : value.value]),
      ),
    }));
  }

  async function addSamplingRow() {
    const prompt = await randomDatasetPrompt();
    setSamplingRows((current) => [...current, createSamplingRow(currentRecipe, prompt)]);
  }

  async function selectDataset(name: string) {
    setDataset(name);
    const canSample = Boolean(currentRecipe?.sampling?.pipeline);
    const hasMediaInput = (currentRecipe?.sampling?.input_schema || [])
      .some((field: any) => ["image", "video", "audio"].includes(field.type));
    const canPopulateInitialSample = samplingRows.length === 0
      || (samplingRows.length === 1 && !samplingRows[0].prompt.trim());
    if (name && canSample && !hasMediaInput && canPopulateInitialSample) {
      const prompt = await randomDatasetPrompt(name);
      setSamplingRows((current) => {
        if (current.length === 0) return [createSamplingRow(currentRecipe, prompt)];
        if (current.length === 1 && !current[0].prompt.trim()) {
          return [{ ...current[0], prompt }];
        }
        return current;
      });
    }
  }

  function updateSamplingRow(index: number, update: (row: SamplingRow) => SamplingRow) {
    setSamplingRows((current) => current.map((row, rowIndex) => rowIndex === index ? update(row) : row));
  }

  function samplingAccept(type: string): string {
    if (type === "image") return "image/*";
    if (type === "video") return "video/*";
    if (type === "audio") return "audio/*";
    return "";
  }

  function validateTrainingNumbers(): string {
    const positiveIntegers: Array<[string, number | ""]> = [
      ["LoRA rank", loraRank],
      ["Dataset repeats", datasetRepeat],
      ["Epochs", numEpochs],
    ];
    for (const [label, value] of positiveIntegers) {
      if (value === "") return `Enter ${label}`;
      if (!Number.isInteger(value) || value <= 0) return `${label} must be a positive integer`;
    }
    if (learningRate === "") return "Enter Learning rate";
    if (!Number.isFinite(learningRate) || learningRate <= 0) {
      return "Learning rate must be a positive number";
    }
    return "";
  }

  function currentConfig(samples: any[] = serializedSamples()) {
    const config: Record<string, any> = {
      model_type: modelType,
      gpu_index: Number(gpuIndex),
      model_paths: modelPaths.filter((mp) => mp.model_id || mp.local_path),
      enable_custom_lora_target: enableCustomLoraTarget,
      lora_target_modules: loraTargetModules,
      lora_rank: loraRank === "" ? null : Number(loraRank),
      dataset,
      dataset_repeat: datasetRepeat === "" ? null : Number(datasetRepeat),
      num_epochs: numEpochs === "" ? null : Number(numEpochs),
      learning_rate: learningRate === "" ? null : Number(learningRate),
      optimizer,
      resume_from_checkpoint: resumeFromCheckpoint.trim(),
      samples,
    };
    if (!currentRecipe?.disable_sections?.includes("resolution")) {
      config.resolution_mode = resolutionMode;
      config.max_pixels = resolutionMode === "max_pixels"
        ? computedMaxPixels
        : maxPixels;
      config.height = height === "" ? null : Number(height);
      config.width = width === "" ? null : Number(width);
    }
    if (currentRecipe?.dataset_kind === "video") {
      config.num_frames = numFrames === "" ? null : Number(numFrames);
    }
    if (stageParameters.some((stage) => Object.keys(stage).length > 0)) {
      config.stage_parameters = stageParameters;
    }
    return config;
  }

  async function onPreview() {
    setMsg("");
    const numericError = validateTrainingNumbers();
    if (numericError) {
      setMsg(numericError);
      return;
    }
    try {
      const r = await api.previewCommand(currentConfig());
      setPreviewCmd(r.argv || []);
    } catch (e: any) {
      setMsg("Preview failed: " + e.message);
    }
  }

  async function onSubmit() {
    setMsg("");
    if (!name.trim()) {
      setMsg("Enter a task name");
      return;
    }
    if (!modelType) {
      setMsg("Select a model type");
      return;
    }
    if (gpuIndex === "") {
      setMsg("Select a GPU");
      return;
    }
    if (!dataset) {
      setMsg("Select a dataset");
      return;
    }
    const numericError = validateTrainingNumbers();
    if (numericError) {
      setMsg(numericError);
      return;
    }
    const inputSchema = currentRecipe?.sampling?.input_schema || [];
    for (const [index, sample] of samplingRows.entries()) {
      if (!sample.prompt.trim()) {
        setMsg(`Enter a prompt for sample ${index + 1}`);
        return;
      }
      for (const field of inputSchema) {
        const value = sample.inputs[field.name];
        const fieldValue = value?.value;
        if (["number", "string", "string_list"].includes(field.type)) {
          if (field.required && (fieldValue === undefined || fieldValue === "" || (Array.isArray(fieldValue) && fieldValue.length === 0))) {
            setMsg(`${field.label || field.name} is required for sample ${index + 1}`);
            return;
          }
          continue;
        }
        if (field.required && !(value?.files.length || value?.paths.length)) {
          setMsg(`${field.label || field.name} is required for sample ${index + 1}`);
          return;
        }
        const requiredCount = Number(field.count || 0);
        const selectedCount = value?.files.length || value?.paths.length || 0;
        if (requiredCount > 0 && selectedCount !== requiredCount) {
          setMsg(`${field.label || field.name} requires ${requiredCount} file(s) for sample ${index + 1}`);
          return;
        }
      }
    }
    try {
      const initial = editTaskId
        ? { id: editTaskId }
        : await api.createTask(name.trim(), currentConfig([]), false);
      const persistedSamples = [];
      for (const sample of samplingRows) {
        const inputs: Record<string, any> = {};
        for (const field of inputSchema) {
          const value = sample.inputs[field.name];
          if (value?.files.length) {
            const uploaded = await api.uploadSamplingInputs(initial.id, sample.id, field.name, value.files);
            inputs[field.name] = uploaded.saved;
          } else if (value?.paths.length) {
            inputs[field.name] = value.paths;
          } else if (value?.value !== undefined) {
            inputs[field.name] = value.value;
          }
        }
        persistedSamples.push({ id: sample.id, prompt: sample.prompt.trim(), inputs });
      }
      const r = await api.updateTask(initial.id, name.trim(), currentConfig(persistedSamples));
      if (!editTaskId && startNow) await api.startTask(r.id);
      setMsg(editTaskId ? `Task ${r.name} updated` : `Task ${r.name} created`);
      router.push(`/tasks/${r.id}`);
    } catch (e: any) {
      setMsg((editTaskId ? "Save failed: " : "Creation failed: ") + e.message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl p-3 sm:p-4 lg:p-6">
      <PageHeader
        title={editTaskId ? "Edit Training Task" : "New Training Task"}
        actions={
          <Link href="/tasks">
            <Button variant="ghost" size="sm">
              ← Back to List
            </Button>
          </Link>
        }
      />

      <div className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Card title="Task Information">
            <Field
              label="Task Name"
              required
            >
              <input
                className="w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!!editTaskId}
              />
            </Field>
            <Field label="GPU" required>
              <select
                className="w-full"
                value={gpuIndex}
                onChange={(e) => setGpuIndex(e.target.value)}
              >
                <option value="">-- Select --</option>
                {gpus.map((gpu) => (
                  <option key={gpu.index} value={gpu.index}>
                    GPU {gpu.index} · {gpu.name} · Free {gpu.memory_free_mb} MB / {gpu.memory_total_mb} MB
                  </option>
                ))}
              </select>
              {gpus.length === 0 && (
                <div className="mt-2 text-xs text-amber-300">No available NVIDIA GPU detected</div>
              )}
            </Field>
          </Card>

          <Card title="Model">
            <Field label="Model Architecture" required>
              <select
                className="w-full"
                value={modelFamily}
                onChange={(e) => selectFamily(e.target.value)}
              >
                <option value="">-- Select --</option>
                {modelFamilies.map((family) => (
                  <option key={family} value={family}>
                    {modelFamilyLabel(family)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Target Model" required>
              <select
                className="w-full"
                value={modelType}
                onChange={(e) => applyRecipe(e.target.value)}
                disabled={!modelFamily}
              >
                <option value="">-- Select --</option>
                {familyRecipes.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Model Paths"
            >
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="min-w-[820px]">
                  <thead>
                    <tr>
                      <th>model_id</th>
                      <th>file_pattern</th>
                      <th>local_path</th>
                      <th className="w-12 text-center">FP8</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelPaths.map((mp, idx) => (
                      <tr key={idx}>
                        <td>
                          <input
                            className="w-full"
                            value={mp.model_id}
                            onChange={(e) => {
                              const next = [...modelPaths];
                              next[idx].model_id = e.target.value;
                              setModelPaths(next);
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="w-full"
                            value={mp.file_pattern}
                            onChange={(e) => {
                              const next = [...modelPaths];
                              next[idx].file_pattern = e.target.value;
                              setModelPaths(next);
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="w-full"
                            value={mp.local_path}
                            onChange={(e) => {
                              const next = [...modelPaths];
                              next[idx].local_path = e.target.value;
                              setModelPaths(next);
                            }}
                          />
                        </td>
                        <td className="text-center">
                          <input
                            type="checkbox"
                            checked={mp.fp8}
                            onChange={(e) => {
                              const next = [...modelPaths];
                              next[idx].fp8 = e.target.checked;
                              setModelPaths(next);
                            }}
                          />
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setModelPaths(modelPaths.filter((_, i) => i !== idx))}
                          >
                            ×
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setModelPaths([
                      ...modelPaths,
                      { model_id: "", file_pattern: "", local_path: "", fp8: false },
                    ])
                  }
                >
                  + Add Row
                </Button>
              </div>
            </Field>

            <Field label="LoRA Settings">
              <div className="mb-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={enableCustomLoraTarget}
                    onChange={(e) => setEnableCustomLoraTarget(e.target.checked)}
                  />
                  Customize LoRA Target Module
                </label>
                <div className="flex w-full items-center justify-between gap-2 text-sm text-slate-300 sm:w-auto sm:justify-start">
                  lora_rank
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="w-24"
                    value={loraRank}
                    onChange={(e) => setLoraRank(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                </div>
              </div>
              <input
                className="w-full"
                value={loraTargetModules}
                onChange={(e) => setLoraTargetModules(e.target.value)}
                disabled={!enableCustomLoraTarget}
              />
            </Field>
          </Card>

          <Card title="Dataset">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Select Dataset" required>
                <select
                  className="w-full"
                  value={dataset}
                  onChange={(e) => void selectDataset(e.target.value)}
                >
                  <option value="">-- Select --</option>
                  {datasets.map((d) => (
                    <option key={d.name} value={d.name}>
                      {DATASET_KIND_LABELS[d.kind] || d.kind} · {d.name} ({d.num_items} items)
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={"Dataset Repeats"}
              >
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="w-full"
                  value={datasetRepeat}
                  onChange={(e) => setDatasetRepeat(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </Field>
            </div>

            {!currentRecipe?.disable_sections?.includes("resolution") && (
              <Field label="Resolution">
                <div className="grid grid-cols-1 gap-3 text-sm text-slate-300 xl:grid-cols-2">
                <label className="flex flex-wrap items-center gap-2">
                  <input
                    type="radio"
                    checked={resolutionMode === "max_pixels"}
                    onChange={() => setResolutionMode("max_pixels")}
                  />
                  max_pixels
                  <span className="min-w-48 font-mono text-xs text-slate-300">
                    {computedMaxPixels === null
                      ? `- px `
                      : `${computedMaxPixels} px`}
                  </span>
                  <input
                    type="number"
                    min={1}
                    className="ml-auto w-20"
                    value={maxPixelHeight}
                    onChange={(e) => setMaxPixelHeight(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={resolutionMode !== "max_pixels"}
                  />
                  <span>×</span>
                  <input
                    type="number"
                    min={1}
                    className="w-20"
                    value={maxPixelWidth}
                    onChange={(e) => setMaxPixelWidth(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={resolutionMode !== "max_pixels"}
                  />
                </label>
                <label className="flex flex-wrap items-center gap-2">
                  <input
                    type="radio"
                    checked={resolutionMode === "hw"}
                    onChange={() => setResolutionMode("hw")}
                  />
                  height × width
                  <input
                    type="number"
                    className="ml-auto w-20"
                    value={height}
                    onChange={(e) => setHeight(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={resolutionMode !== "hw"}
                  />
                  <span>×</span>
                  <input
                    type="number"
                    className="w-20"
                    value={width}
                    onChange={(e) => setWidth(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={resolutionMode !== "hw"}
                  />
                </label>
                </div>
              </Field>
            )}

            {currentRecipe?.dataset_kind === "video" && (
              <Field label="num_frames">
                <input
                  type="number"
                  className="w-32"
                  value={numFrames}
                  onChange={(e) => setNumFrames(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </Field>
            )}

          </Card>

          {stageParameters.some((stage) => Object.keys(stage).length > 0) && (
            <Card title="Multi-stage Training Parameters">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {stageParameters.map((stage, index) => {
                  if (Object.keys(stage).length === 0) return null;
                  return (
                    <div key={index} className="border-l-2 border-slate-700 pl-4">
                      <div className="mb-3 text-sm font-medium text-slate-200">
                        Stage {index + 1}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {stage.min_timestep_boundary !== undefined && (
                          <Field label="min_timestep_boundary">
                            <input
                              type="number"
                              min={0}
                              max={1}
                              step="any"
                              className="w-full"
                              value={stage.min_timestep_boundary}
                              onChange={(event) => {
                                const next = stageParameters.map((item) => ({ ...item }));
                                next[index].min_timestep_boundary = Number(event.target.value);
                                setStageParameters(next);
                              }}
                            />
                          </Field>
                        )}
                        {stage.max_timestep_boundary !== undefined && (
                          <Field label="max_timestep_boundary">
                            <input
                              type="number"
                              min={0}
                              max={1}
                              step="any"
                              className="w-full"
                              value={stage.max_timestep_boundary}
                              onChange={(event) => {
                                const next = stageParameters.map((item) => ({ ...item }));
                                next[index].max_timestep_boundary = Number(event.target.value);
                                setStageParameters(next);
                              }}
                            />
                          </Field>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card title="Training">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Epochs">
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="w-full"
                  value={numEpochs}
                  onChange={(e) => setNumEpochs(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </Field>
              <Field label="Learning Rate">
                <input
                  type="number"
                  min={Number.MIN_VALUE}
                  step="any"
                  className="w-full"
                  value={learningRate}
                  onChange={(e) => setLearningRate(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </Field>
              <Field label="Optimizer">
                <select
                  className="w-full"
                  value={optimizer}
                  onChange={(e) => setOptimizer(e.target.value)}
                >
                  {OPTIMIZERS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="mt-4">
              <Field
                label="Resume from checkpoint"
              >
                <input
                  className="w-full"
                  value={resumeFromCheckpoint}
                  onChange={(e) => setResumeFromCheckpoint(e.target.value)}
                />
              </Field>
            </div>
          </Card>

          {currentRecipe?.sampling?.pipeline && (
            <Card
              title={`Sampling (${samplingRows.length})`}
              actions={<Button variant="outline" size="sm" onClick={addSamplingRow}>+ Add Sample</Button>}
            >
              {samplingRows.length === 0 ? (
                <div className="py-5 text-center text-sm text-slate-400">
                  No samples configured. Sampling will be skipped after training.
                </div>
              ) : (
                <div className="space-y-3">
                  {samplingRows.map((sample, index) => (
                    <div key={sample.id} className="border border-slate-800 bg-slate-950/30 p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-slate-200">Sample {index + 1}</div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSamplingRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                        >
                          Remove
                        </Button>
                      </div>
                      <Field label="Prompt" required>
                        <textarea
                          className="min-h-16 w-full resize-y"
                          value={sample.prompt}
                          onChange={(event) => updateSamplingRow(index, (row) => ({ ...row, prompt: event.target.value }))}
                        />
                      </Field>
                      {(currentRecipe.sampling.input_schema || []).some((field: any) => field.name === "duration") && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {(currentRecipe.sampling.input_schema || [])
                            .filter((field: any) => ["duration", "vocal_language"].includes(field.name))
                            .map((field: any) => {
                              const value = sample.inputs[field.name] || { files: [], paths: [], value: field.default };
                              return (
                                <Field key={field.name} label={field.label || field.name} required={field.required}>
                                  <input
                                    type={field.type === "number" ? "number" : "text"}
                                    step={field.type === "number" ? "any" : undefined}
                                    className="w-full"
                                    value={value.value ?? field.default ?? ""}
                                    onChange={(event) => updateSamplingRow(index, (row) => ({
                                      ...row,
                                      inputs: {
                                        ...row.inputs,
                                        [field.name]: {
                                          ...value,
                                          value: field.type === "number"
                                            ? (event.target.value === "" ? "" : Number(event.target.value))
                                            : event.target.value,
                                        },
                                      },
                                    }))}
                                  />
                                </Field>
                              );
                            })}
                        </div>
                      )}
                      {(currentRecipe.sampling.input_schema || []).some((field: any) => field.name === "camera_control_direction") && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {(currentRecipe.sampling.input_schema || [])
                            .filter((field: any) => ["camera_control_direction", "camera_control_speed"].includes(field.name))
                            .map((field: any) => {
                              const value = sample.inputs[field.name] || { files: [], paths: [], value: field.default };
                              const fieldValue = value.value ?? field.default ?? "";
                              const updateValue = (raw: string) => updateSamplingRow(index, (row) => ({
                                ...row,
                                inputs: {
                                  ...row.inputs,
                                  [field.name]: {
                                    ...value,
                                    value: field.type === "number" ? (raw === "" ? "" : Number(raw)) : raw,
                                  },
                                },
                              }));
                              return (
                                <Field key={field.name} label={field.label || field.name} required={field.required}>
                                  {field.type === "string" && Array.isArray(field.options) ? (
                                    <select
                                      className="w-full"
                                      value={fieldValue}
                                      onChange={(event) => updateValue(event.target.value)}
                                    >
                                      {field.options.map((option: string) => (
                                        <option key={option} value={option}>{option}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      type={field.type === "number" ? "number" : "text"}
                                      step={field.type === "number" ? "any" : undefined}
                                      className="w-full"
                                      value={fieldValue}
                                      onChange={(event) => updateValue(event.target.value)}
                                    />
                                  )}
                                </Field>
                              );
                            })}
                        </div>
                      )}
                      {(currentRecipe.sampling.input_schema || []).filter((field: any) => !["height", "width", "num_frames", "num_inference_steps", "cfg_scale", "duration", "vocal_language", "camera_control_direction", "camera_control_speed"].includes(field.name)).map((field: any) => {
                        const value = sample.inputs[field.name] || { files: [], paths: [] };
                        const textValue = field.type === "string_list" && Array.isArray(value.value)
                          ? value.value.join("\n")
                          : value.value ?? "";
                        const updateValue = (raw: string) => {
                          const nextValue = field.type === "number"
                            ? (raw === "" ? "" : Number(raw))
                            : field.type === "string_list"
                              ? raw.split(/\r?\n/).map((item: string) => item.trim()).filter(Boolean)
                              : raw;
                          updateSamplingRow(index, (row) => ({
                            ...row,
                            inputs: { ...row.inputs, [field.name]: { ...value, value: nextValue } },
                          }));
                        };
                        return (
                          <Field key={field.name} label={field.label || field.name} required={field.required}>
                            {field.type === "string" && Array.isArray(field.options) ? (
                              <select
                                className="w-full"
                                value={textValue}
                                onChange={(event) => updateValue(event.target.value)}
                              >
                                {field.options.map((option: string) => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                              </select>
                            ) : field.type === "string" || field.type === "string_list" ? (
                              <textarea
                                className="min-h-16 w-full resize-y"
                                value={textValue}
                                onChange={(event) => updateValue(event.target.value)}
                              />
                            ) : field.type === "number" ? (
                              <input type="number" step="any" className="w-full" value={textValue} onChange={(event) => updateValue(event.target.value)} />
                            ) : (
                              <>
                                <input
                                  id={`sampling-${sample.id}-${field.name}`}
                                  type="file"
                                  className="hidden"
                                  accept={samplingAccept(field.type)}
                                  multiple={Boolean(field.multiple)}
                                  onChange={(event) => {
                                    const files = Array.from(event.target.files || []);
                                    updateSamplingRow(index, (row) => ({
                                      ...row,
                                      inputs: { ...row.inputs, [field.name]: { files, paths: [] } },
                                    }));
                                  }}
                                />
                                <div className="flex items-start gap-3">
                                  <label
                                    htmlFor={`sampling-${sample.id}-${field.name}`}
                                    className="inline-flex cursor-pointer items-center rounded border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-500"
                                  >
                                    Choose File{field.multiple ? "s" : ""}
                                  </label>
                                  {(value.files.length > 0 || value.paths.length > 0) && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        updateSamplingRow(index, (row) => ({
                                          ...row,
                                          inputs: {
                                            ...row.inputs,
                                            [field.name]: { files: [], paths: [] },
                                          },
                                        }));
                                        const input = document.getElementById(
                                          `sampling-${sample.id}-${field.name}`,
                                        ) as HTMLInputElement | null;
                                        if (input) input.value = "";
                                      }}
                                    >
                                      Clear
                                    </Button>
                                  )}
                                  {value.files.length > 0 || value.paths.length > 0 ? (
                                    <ol className="min-w-0 flex-1 space-y-1 text-xs text-slate-400">
                                      {(value.files.length > 0
                                        ? value.files.map((file) => file.name)
                                        : value.paths.map((path) => path.split("/").pop() || path)
                                      ).map((fileName, fileIndex) => (
                                        <li key={`${fileIndex}-${fileName}`} className="flex min-w-0 gap-2">
                                          <span className="shrink-0 text-slate-500">{fileIndex + 1}.</span>
                                          <span className="min-w-0 break-all text-slate-300">{fileName}</span>
                                        </li>
                                      ))}
                                    </ol>
                                  ) : (
                                    <span className="text-xs text-slate-400">No files selected</span>
                                  )}
                                </div>
                              </>
                            )}
                            {Number(field.count || 0) > 1 && (
                              <div className="mt-1 text-xs text-slate-400">
                                Select exactly {field.count} files in the displayed order.
                              </div>
                            )}
                          </Field>
                        );
                      })}
                      <div
                        className="grid gap-3"
                        style={{
                          gridTemplateColumns: `repeat(${Math.max(
                            1,
                            (currentRecipe.sampling.input_schema || []).filter((field: any) =>
                              ["height", "width", "num_frames", "num_inference_steps", "cfg_scale"].includes(field.name),
                            ).length,
                          )}, minmax(0, 1fr))`,
                        }}
                      >
                        {(currentRecipe.sampling.input_schema || [])
                          .filter((field: any) => ["height", "width", "num_frames", "num_inference_steps", "cfg_scale"].includes(field.name))
                          .map((field: any) => {
                            const value = sample.inputs[field.name] || { value: field.default ?? 1024, files: [], paths: [] };
                            return (
                              <Field key={field.name} label={field.label || field.name}>
                                <input
                                  type="number"
                                  className="w-full"
                                  value={value.value ?? field.default ?? 1024}
                                  onChange={(event) => updateSamplingRow(index, (row) => ({
                                    ...row,
                                    inputs: {
                                      ...row.inputs,
                                      [field.name]: {
                                        ...value,
                                        value: event.target.value === "" ? "" : Number(event.target.value),
                                      },
                                    },
                                  }))}
                                />
                              </Field>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

        </div>

        <div className="min-w-0 space-y-4">
          <Card title={editTaskId ? "Save" : "Create"} className="sticky top-4">
            {!editTaskId && <label className="flex items-center gap-2 text-sm text-slate-300 mb-3">
              <input
                type="checkbox"
                checked={startNow}
                onChange={(e) => setStartNow(e.target.checked)}
              />
              Start immediately after creation
            </label>}
            <div className="flex flex-col gap-2">
              <Button onClick={onSubmit}>{editTaskId ? "Save Changes" : "Create Task"}</Button>
              <Button variant="outline" onClick={onPreview}>
                Preview Launch Command
              </Button>
            </div>
            {msg && <div className="text-xs text-slate-400 mt-3">{msg}</div>}
          </Card>

          {previewCmd.length > 0 && (
            <Card title="Launch Command">
              <pre className="whitespace-pre mono text-[11px] text-slate-300 max-h-80 overflow-auto">
                {formatShellCommand(previewCmd)}
              </pre>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
