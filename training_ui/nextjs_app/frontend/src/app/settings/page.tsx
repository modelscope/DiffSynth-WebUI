"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, EmptyState, Field, PageHeader } from "@/components/ui";

const GENERAL_ROWS: Array<{ key: string; label: string; hint?: string }> = [
  {
    key: "DATASETS_ROOT",
    label: "Dataset Directory",
    hint: "Directory for raw data and metadata storage.",
  },
  {
    key: "MODEL_SAVE_ROOT",
    label: "Training Output Directory",
    hint: "Directory for writing training artifacts (checkpoints, logs, samples, configs).",
  },
  {
    key: "DIFFSYNTH_MODEL_BASE_PATH",
    label: "Model Storage Directory",
    hint: "Directory for storing downloaded model files, relative to the DiffSynth-WebUI root.",
  },
  {
    key: "DIFFSYNTH_DOWNLOAD_SOURCE",
    label: "Model Download Source",
  },
  {
    key: "DIFFSYNTH_ATTENTION_IMPLEMENTATION",
    label: "Attention Implementation",
  },
];

type CaptionModel = {
  id: string;
  name: string;
  base_url: string;
  model_id: string;
  supports_image: boolean;
  supports_video: boolean;
  supports_audio: boolean;
  api_key_configured: boolean;
};

type ModelForm = {
  name: string;
  base_url: string;
  api_key: string;
  model_id: string;
  supports_image: boolean;
  supports_video: boolean;
  supports_audio: boolean;
};

const EMPTY_MODEL: ModelForm = {
  name: "", base_url: "", api_key: "", model_id: "",
  supports_image: true, supports_video: false, supports_audio: false,
};

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [models, setModels] = useState<CaptionModel[]>([]);
  const [editing, setEditing] = useState<CaptionModel | null | undefined>(undefined);
  const [form, setForm] = useState<ModelForm>(EMPTY_MODEL);
  const [savingModel, setSavingModel] = useState(false);
  const [modelError, setModelError] = useState("");
  const [msg, setMsg] = useState("");

  async function reload() {
    const [settingsResult, modelsResult] = await Promise.allSettled([
      api.getSettings(), api.listCaptionModels(),
    ]);
    const errors: string[] = [];
    if (settingsResult.status === "fulfilled") {
      const loadedValues = { ...(settingsResult.value.settings || {}) };
      loadedValues.DATASETS_ROOT ||= "training_ui/data/datasets";
      loadedValues.MODEL_SAVE_ROOT ||= "training_ui/data/outputs";
      loadedValues.DIFFSYNTH_MODEL_BASE_PATH ||= "DiffSynth-Studio/models";
      loadedValues.DIFFSYNTH_DOWNLOAD_SOURCE ||= "modelscope";
      setValues(loadedValues);
    } else errors.push(`Failed to load settings: ${settingsResult.reason?.message || settingsResult.reason}`);
    if (modelsResult.status === "fulfilled") setModels(modelsResult.value.models || []);
    else errors.push(`Failed to load captioning models: ${modelsResult.reason?.message || modelsResult.reason}`);
    setMsg(errors.join("; "));
  }

  useEffect(() => { void reload(); }, []);

  async function onSaveSettings() {
    try {
      await api.setSettings(values);
      await reload();
      setMsg("Saved");
    } catch (error: any) {
      setMsg("Save failed: " + error.message);
    }
  }

  function openModel(model?: CaptionModel) {
    setModelError("");
    setEditing(model || null);
    setForm(model ? {
      name: model.name,
      base_url: model.base_url,
      api_key: "",
      model_id: model.model_id,
      supports_image: model.supports_image,
      supports_video: model.supports_video,
      supports_audio: model.supports_audio,
    } : { ...EMPTY_MODEL });
  }

  async function savePromptModel() {
    setModelError("");
    try {
      setSavingModel(true);
      if (editing) await api.updateCaptionModel(editing.id, form);
      else await api.createCaptionModel(form);
      setEditing(undefined);
      await reload();
    } catch (error: any) {
      setModelError("Failed to save captioning model: " + error.message);
    } finally {
      setSavingModel(false);
    }
  }

  async function removePromptModel(model: CaptionModel) {
    if (!confirm(`Delete captioning model "${model.name}"?`)) return;
    try {
      await api.deleteCaptionModel(model.id);
      await reload();
    } catch (error: any) {
      setMsg("Failed to delete captioning model: " + error.message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-3 sm:p-4 lg:p-6">
      <PageHeader title="Settings" />
      {msg && <div className="mb-3 text-xs text-slate-400">{msg}</div>}
      <div className="space-y-4">
        <Card
          title="Captioning Models"
          subtitle="Multimodal models used to caption image, video, and audio samples."
          actions={<Button size="sm" onClick={() => openModel()}>Add Model</Button>}
          padded={models.length > 0}
        >
          {models.length === 0 ? (
            <EmptyState
              title="No captioning models configured"
              hint="Add a multimodal model to caption dataset samples automatically."
              action={<Button onClick={() => openModel()}>Add your first model</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead><tr><th>Name</th><th>Model ID</th><th>Applies to</th><th /></tr></thead>
                <tbody>
                  {models.map((model) => (
                    <tr key={model.id}>
                      <td><div className="font-medium text-slate-100">{model.name}</div><div className="max-w-64 truncate text-xs text-slate-400">{model.base_url}</div></td>
                      <td><code className="text-xs">{model.model_id}</code></td>
                      <td><div className="flex flex-wrap gap-1">{model.supports_image && <Tag>Image</Tag>}{model.supports_video && <Tag>Video</Tag>}{model.supports_audio && <Tag>Audio</Tag>}</div></td>
                      <td><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => openModel(model)}>Edit</Button><Button variant="danger" size="sm" onClick={() => removePromptModel(model)}>Delete</Button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="General">
          {GENERAL_ROWS.map((row) => (
            <Field key={row.key} label={row.label} hint={row.hint}>
              {row.key === "DIFFSYNTH_DOWNLOAD_SOURCE" ? (
                <select className="w-full" value={values[row.key] || "modelscope"} onChange={(event) => setValues({ ...values, [row.key]: event.target.value })}>
                  <option value="modelscope">ModelScope</option><option value="huggingface">Hugging Face</option>
                </select>
              ) : (
                row.key === "DIFFSYNTH_ATTENTION_IMPLEMENTATION" ? (
                  <input className="w-full" value={values[row.key] || ""} onChange={(event) => setValues({ ...values, [row.key]: event.target.value })} placeholder="auto"/>
                ) : (
                <input className="w-full" value={values[row.key] || ""} onChange={(event) => setValues({ ...values, [row.key]: event.target.value })}/>
                )
              )}
            </Field>
          ))}
        </Card>

        <div className="flex justify-end">
          <Button onClick={onSaveSettings}>Save Settings</Button>
        </div>
      </div>

      {editing !== undefined && (
        <Modal title={editing ? "Edit Captioning Model" : "Add Captioning Model"} onClose={() => !savingModel && setEditing(undefined)}>
          <Field label="Name" required><input className="w-full" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="API Base URL" required><input className="w-full" value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })}/></Field>
          <Field label="API Key" required={!editing}><input type="password" autoComplete="new-password" className="w-full" value={form.api_key} onChange={(event) => setForm({ ...form, api_key: event.target.value })} placeholder={editing?.api_key_configured ? "Configured" : "sk-"} /></Field>
          <Field label="Model ID" required><input className="w-full" value={form.model_id} onChange={(event) => setForm({ ...form, model_id: event.target.value })}/></Field>
          <Field label="Applies To" required hint="This model is offered when captioning the selected media types."><div className="flex flex-wrap gap-5">{([['supports_image', 'Image'], ['supports_video', 'Video'], ['supports_audio', 'Audio']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} />{label}</label>)}</div></Field>
          <div className="mt-3 flex items-end justify-end gap-3">
            {modelError && <div className="mr-auto max-w-[70%] text-xs text-red-400">{modelError}</div>}
            <Button variant="ghost" disabled={savingModel} onClick={() => setEditing(undefined)}>Cancel</Button>
            <Button disabled={savingModel} onClick={savePromptModel}>{savingModel ? "Saving..." : "Save"}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">{children}</span>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={onClose}><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-base font-semibold text-slate-100">{title}</h2><button type="button" className="text-xl text-slate-400 hover:text-white" onClick={onClose}>×</button></div>{children}</div></div>;
}
