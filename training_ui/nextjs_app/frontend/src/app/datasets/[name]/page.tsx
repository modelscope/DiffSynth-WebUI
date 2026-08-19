"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { apiUrl } from "@/lib/basePath";
import { Button, Card, EmptyState, Field, PageHeader } from "@/components/ui";

const DEFAULT_INSTRUCTION =
  "Describe the content of this sample accurately and naturally. Return only the description.";

type Filter = "all" | "labeled" | "missing";
type BatchScope = "selected" | "missing";
type BatchResult = {
  running: boolean;
  current: number;
  total: number;
  success: number;
  failed: number;
  errors: string[];
};
type CaptionModel = {
  id: string;
  name: string;
  model_id: string;
  supports_image: boolean;
  supports_video: boolean;
  supports_audio: boolean;
  api_key_configured: boolean;
};

function mediaField(mediaPath: string) {
  const extension = mediaPath.split(".").pop()?.toLowerCase();
  if (["mp4", "webm", "mov", "mkv", "avi"].includes(extension || "")) return "video";
  if (["wav", "mp3", "flac", "ogg", "m4a", "aac"].includes(extension || "")) return "audio";
  return "image";
}

function modelSupports(model: CaptionModel, kind: string) {
  if (kind === "video") return model.supports_video;
  if (kind === "audio") return model.supports_audio;
  return model.supports_image;
}

export default function DatasetDetailPage() {
  const params = useParams<{ name: string }>();
  const name = decodeURIComponent(params.name);
  const [detail, setDetail] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [captionModels, setCaptionModels] = useState<CaptionModel[]>([]);
  const [captionModelId, setCaptionModelId] = useState("");
  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
  const [batchScope, setBatchScope] = useState<BatchScope>("selected");
  const [rewriteExisting, setRewriteExisting] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [generatedDrafts, setGeneratedDrafts] = useState(false);
  const stopBatchRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listCaptionModels().then((result) => {
      const loaded = result.models || [];
      setCaptionModels(loaded);
      if (loaded[0]) setCaptionModelId(loaded[0].id);
    }).catch(() => {});
  }, []);

  async function reload() {
    try {
      const data = await api.datasetDetail(name);
      setDetail(data);
      setGeneratedDrafts(false);
      setSelected((current) =>
        current && data.media?.includes(current) ? current : (data.media?.[0] || ""),
      );
      setSelection((current) => new Set([...current].filter((item) => data.media.includes(item))));
    } catch (error: any) {
      setMsg("Failed to load: " + error.message);
    }
  }

  useEffect(() => {
    reload();
  }, [name]);

  const metadataByPath = useMemo(() => {
    const index = new Map<string, any>();
    for (const item of detail?.metadata || []) {
      const mediaPath = getMediaPath(item);
      if (mediaPath) index.set(normalizeMediaPath(mediaPath), item);
    }
    return index;
  }, [detail]);

  const filteredMedia = useMemo(() => {
    if (!detail) return [];
    return detail.media.filter((mediaPath: string) => {
      const prompt = String(metadataByPath.get(normalizeMediaPath(mediaPath))?.prompt || "").trim();
      if (filter === "labeled") return Boolean(prompt);
      if (filter === "missing") return !prompt;
      return true;
    });
  }, [detail, filter, metadataByPath]);

  const selectedItem = useMemo(() => {
    if (!detail || !selected) return null;
    return metadataByPath.get(normalizeMediaPath(selected)) || { [mediaField(selected)]: selected, prompt: "" };
  }, [detail, metadataByPath, selected]);

  const compatibleCaptionModels = useMemo(
    () => {
      if (!detail) return [];
      let targets: string[] = [];
      if (batchScope === "selected") {
        targets = [...selection];
      } else {
        targets = detail.media.filter((path: string) => {
          const prompt = String(metadataByPath.get(normalizeMediaPath(path))?.prompt || "").trim();
          return rewriteExisting || !prompt;
        });
      }
      const kinds = new Set(targets.map((path) => mediaField(path)));
      if (kinds.size === 0) return [];
      return captionModels.filter((model) => [...kinds].every((kind) => modelSupports(model, kind)));
    },
    [batchScope, captionModels, detail, metadataByPath, rewriteExisting, selection],
  );

  useEffect(() => {
    if (compatibleCaptionModels.length === 0) {
      setCaptionModelId("");
      return;
    }
    if (!compatibleCaptionModels.some((model) => model.id === captionModelId)) {
      setCaptionModelId(compatibleCaptionModels[0].id);
    }
  }, [compatibleCaptionModels, captionModelId]);

  function chooseFiles(files: FileList | null) {
    setUploadError("");
    setPendingFiles(files ? Array.from(files) : []);
  }

  async function onUpload() {
    if (pendingFiles.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      const result = await api.uploadFiles(name, pendingFiles);
      setMsg(`Uploaded ${result.saved?.length ?? 0} files`);
      setPendingFiles([]);
      setUploadOpen(false);
      if (fileRef.current) fileRef.current.value = "";
      await reload();
    } catch (error: any) {
      setUploadError("Upload failed: " + error.message);
    } finally {
      setUploading(false);
    }
  }

  function toggleSelection(mediaPath: string) {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(mediaPath)) next.delete(mediaPath);
      else next.add(mediaPath);
      return next;
    });
  }

  async function onDeleteSelected() {
    if (selection.size === 0) {
      setMsg("Select sample to delete first");
      return;
    }
    if (generatedDrafts) {
      setMsg("Save or discard the generated prompts before deleting samples");
      return;
    }
    const files = [...selection];
    if (!confirm(`Permanently delete the selected ${files.length} files?`)) return;
    setDeleting(true);
    try {
      const result = await api.deleteDatasetMedia(name, files);
      setMsg(`Deleted ${result.deleted?.length ?? 0} files`);
      setSelection(new Set());
      await reload();
    } catch (error: any) {
      setMsg("Delete failed: " + error.message);
    } finally {
      setDeleting(false);
    }
  }

  function updatePromptLocally(mediaPath: string, prompt: string) {
    setDetail((current: any) => {
      if (!current) return current;
      const items = [...current.metadata];
      const index = items.findIndex((item) => getMediaPath(item) === mediaPath);
      if (index >= 0) items[index] = { ...items[index], prompt };
      else items.push({ [mediaField(mediaPath)]: mediaPath, prompt });
      return { ...current, metadata: items };
    });
  }

  function batchTargets(): string[] {
    if (!detail) return [];
    let candidates: string[];
    if (batchScope === "selected") candidates = [...selection];
    else candidates = detail.media.filter((path: string) => {
      return !String(metadataByPath.get(normalizeMediaPath(path))?.prompt || "").trim();
    });
    return candidates.filter((path) => {
      if (rewriteExisting) return true;
      return !String(metadataByPath.get(normalizeMediaPath(path))?.prompt || "").trim();
    });
  }

  async function startBatchGeneration() {
    if (!captionModelId) {
      setBatchResult({ running: false, current: 0, total: 0, success: 0, failed: 0, errors: ["Configure a compatible captioning model before generating prompts."] });
      return;
    }
    const targets = batchTargets();
    if (targets.length === 0) {
      setBatchResult({
        running: false,
        current: 0,
        total: 0,
        success: 0,
        failed: 0,
        errors: ["No eligible samples found."],
      });
      return;
    }
    stopBatchRef.current = false;
    let success = 0;
    let failed = 0;
    const errors: string[] = [];
    setBatchResult({ running: true, current: 0, total: targets.length, success, failed, errors });

    for (let index = 0; index < targets.length; index += 1) {
      if (stopBatchRef.current) break;
      const mediaPath = targets[index];
      setBatchResult({
        running: true,
        current: index + 1,
        total: targets.length,
        success,
        failed,
        errors: [...errors],
      });
      try {
        const currentPrompt = String(metadataByPath.get(normalizeMediaPath(mediaPath))?.prompt || "");
        const result = await api.generateDatasetPrompt(
          name,
          mediaPath,
          captionModelId,
          instruction,
          currentPrompt,
        );
        updatePromptLocally(mediaPath, result.prompt);
        success += 1;
      } catch (error: any) {
        failed += 1;
        errors.push(`${mediaPath}: ${error.message || "Failed to generate prompt"}`);
      }
    }
    if (success > 0) setGeneratedDrafts(true);
    setBatchResult({
      running: false,
      current: Math.min(success + failed, targets.length),
      total: targets.length,
      success,
      failed,
      errors,
    });
  }

  async function saveGeneratedDrafts() {
    if (!detail) return;
    try {
      await api.saveMetadata(name, detail.metadata);
      setMsg("Generated prompts saved.");
      setGeneratedDrafts(false);
      setBatchOpen(false);
      setBatchResult(null);
      await reload();
    } catch (error: any) {
      setMsg("Save failed: " + error.message);
      throw error;
    }
  }

  async function discardGeneratedDrafts() {
    stopBatchRef.current = true;
    setBatchOpen(false);
    setBatchResult(null);
    await reload();
    setMsg("Unsaved generated prompts discarded.");
  }

  async function onSaveOne(newItem: any) {
    if (!detail) return;
    if (generatedDrafts) {
      setMsg("Save or discard the generated prompts first");
      return;
    }
    const items = [...detail.metadata];
    const mediaPath = getMediaPath(newItem);
    const index = items.findIndex((item) => getMediaPath(item) === mediaPath);
    if (index >= 0) items[index] = newItem;
    else items.push(newItem);
    try {
      await api.saveMetadata(name, items);
      setDetail((current: any) => current ? { ...current, metadata: items } : current);
    } catch (error: any) {
      setMsg("Save failed: " + error.message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl p-4 lg:p-6">
      <PageHeader
        title={`Dataset · ${name}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
              Import Files
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              setBatchResult(null);
              setBatchOpen(true);
            }}>
              Auto-Caption
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleting || selection.size === 0}
              onClick={onDeleteSelected}
            >
              {deleting ? "Deleting..." : `Delete Selected${selection.size ? ` (${selection.size})` : ""}`}
            </Button>
            <Link href="/datasets">
              <Button variant="ghost" size="sm">← Back to List</Button>
            </Link>
          </>
        }
      />

      {msg && <div className="mb-3 text-xs text-slate-400">{msg}</div>}
      {generatedDrafts && (
        <div className="mb-3 flex items-center justify-between border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <span>Generated prompts have not been saved yet.</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveGeneratedDrafts}>Save Prompts</Button>
            <Button variant="ghost" size="sm" onClick={discardGeneratedDrafts}>Discard Results</Button>
          </div>
        </div>
      )}

      {!detail ? (
        <div className="text-slate-400">Loading...</div>
      ) : (
        <>
          <div className="min-w-0">
            <Card
              title={`Samples (${detail.media.length})`}
              actions={
                <div className="flex items-center gap-2">
                  <select
                    className="h-8 text-xs"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value as Filter)}
                  >
                    <option value="all">All</option>
                    <option value="labeled">Has Prompt</option>
                    <option value="missing">No Prompt</option>
                  </select>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelection(new Set(filteredMedia))}
                  >
                    Select All
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelection(new Set())}>
                    Clear Selection
                  </Button>
                  <span className="text-xs text-slate-400">Selected {selection.size}</span>
                </div>
              }
            >
              {filteredMedia.length === 0 ? (
                <EmptyState title={detail.media.length ? "No sample matches the filter" : "Empty dataset"} />
              ) : (
                <div className="grid h-[49vh] grid-cols-4 content-start gap-3 overflow-y-auto pr-2 2xl:grid-cols-5">
                  {filteredMedia.map((mediaPath: string) => {
                    const image = isImagePath(mediaPath);
                    const metadata = metadataByPath.get(normalizeMediaPath(mediaPath));
                    const prompt = String(metadata?.prompt || "").trim();
                    const checked = selection.has(mediaPath);
                    const active = selected === mediaPath;
                    const previewHeight = "h-36";
                    const url = apiUrl(
                      `/api/datasets/${encodeURIComponent(name)}/media/${encodeURIComponent(mediaPath)}`,
                    );
                    return (
                      <div
                        key={mediaPath}
                        role="button"
                        tabIndex={0}
                        className={
                          "relative flex cursor-pointer flex-col overflow-hidden rounded border transition-all " +
                          (active
                            ? "border-blue-500 ring-2 ring-blue-500/30"
                            : checked
                              ? "border-emerald-500 ring-2 ring-emerald-500/20"
                              : "border-slate-800 hover:border-slate-600")
                        }
                        onClick={() => { setSelected(mediaPath); setEditorOpen(true); }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") setSelected(mediaPath);
                        }}
                      >
                        <button
                          type="button"
                          className={
                            "absolute right-2 top-2 z-10 grid h-5 w-5 place-items-center rounded-full border-2 shadow " +
                            (checked
                              ? "border-emerald-300 bg-emerald-500"
                              : "border-white/80 bg-slate-950/70")
                          }
                          aria-label={checked ? `Deselect ${mediaPath}` : `Select ${mediaPath}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleSelection(mediaPath);
                          }}
                        >
                          {checked && <span className="h-2 w-2 rounded-full bg-white" />}
                        </button>
                        {image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={url}
                            alt={mediaPath}
                            className={`${previewHeight} w-full shrink-0 object-cover`}
                          />
                        ) : isVideoPath(mediaPath) ? (
                          <VideoCardPreview src={url} className={previewHeight} />
                        ) : isAudioPath(mediaPath) ? (
                          <AudioCardPreview src={url} className={previewHeight} />
                        ) : (
                          <div className="flex h-24 w-full shrink-0 items-center justify-center bg-slate-800 text-xs text-slate-400">
                            {mediaPath.split(".").pop()?.toUpperCase()}
                          </div>
                        )}
                        <div className="relative z-[1] flex h-8 shrink-0 items-center justify-between gap-2 bg-slate-950 px-2 text-[11px]">
                          <span className="min-w-0 truncate text-slate-200" title={mediaPath}>{mediaPath}</span>
                          <span className={`shrink-0 ${prompt ? "text-emerald-300" : "text-slate-400"}`}>
                            {prompt ? "Has Prompt" : "No Prompt"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

          </div>

          <div className="mt-4">
            <Card padded={false}>
              <MetadataTable
                items={detail.metadata}
                disabled={generatedDrafts}
                onSave={async (items) => {
                  await api.saveMetadata(name, items);
                  setMsg("Saved all metadata.jsonl records");
                  await reload();
                }}
              />
            </Card>
          </div>
        </>
      )}

      {uploadOpen && (
        <Modal title="Upload Files" onClose={() => !uploading && setUploadOpen(false)}>
          <div
            className={
              "cursor-pointer rounded border-2 border-dashed px-4 py-8 transition-colors " +
              (dragging
                ? "border-blue-400 bg-blue-500/10"
                : pendingFiles.length
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : "border-slate-700 bg-slate-950/30")
            }
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") fileRef.current?.click();
            }}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              chooseFiles(event.dataTransfer.files);
            }}
          >
            {pendingFiles.length === 0 ? (
              <div className="text-center">
                <div className="text-sm font-medium text-slate-200">Click to select or drag files here</div>
                <div className="mt-1 text-xs text-slate-400">Images / Videos / Audio / ZIP / TAR / TGZ</div>
              </div>
            ) : (
              <div>
                <div className="mb-2 text-sm text-emerald-300">{pendingFiles.length} files selected</div>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {pendingFiles.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex justify-between gap-3 text-xs">
                      <span className="truncate text-slate-300">{file.name}</span>
                      <span className="shrink-0 text-slate-400">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.zip,.tar,.tgz,.tar.gz,application/zip,application/x-tar,application/gzip"
            className="hidden"
            onChange={(event) => chooseFiles(event.target.files)}
          />
          {uploadError && <div className="mt-3 text-xs text-red-400">{uploadError}</div>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" disabled={uploading} onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button disabled={uploading || pendingFiles.length === 0} onClick={onUpload}>
              {uploading ? "Uploading..." : `Upload${pendingFiles.length ? ` (${pendingFiles.length})` : ""}`}
            </Button>
          </div>
        </Modal>
      )}

      {batchOpen && (
        <Modal
          title="Auto-Caption"
          onClose={() => {
            if (!batchResult?.running && !generatedDrafts) {
              setBatchOpen(false);
              setBatchResult(null);
            }
          }}
        >
          <Field label="Scope">
            <select
              className="w-full"
              value={batchScope}
              disabled={batchResult?.running}
              onChange={(event) => setBatchScope(event.target.value as BatchScope)}
            >
              <option value="selected">Selected Samples ({selection.size})</option>
              <option value="missing">Samples Without Prompts</option>
            </select>
          </Field>
          <Field label="Captioning Model" required>
            {compatibleCaptionModels.length > 0 ? (
              <select className="w-full" value={captionModelId} disabled={batchResult?.running} onChange={(event) => setCaptionModelId(event.target.value)}>
                {compatibleCaptionModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.model_id}</option>)}
              </select>
            ) : (
              <div className="flex items-center justify-between gap-3 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <span>No compatible captioning model is configured.</span><Link href="/settings" className="shrink-0">Configure Models</Link>
              </div>
            )}
          </Field>
          <Field label="Overwrite Existing Prompts">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={rewriteExisting}
                disabled={batchResult?.running}
                onChange={(event) => setRewriteExisting(event.target.checked)}
              />
              Caption samples that already have one
            </label>
          </Field>
          <Field label="Instructions">
            <textarea
              className="min-h-24 w-full"
              value={instruction}
              disabled={batchResult?.running}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </Field>

          {batchResult && (
            <div className="mb-4 border-t border-slate-800 pt-3 text-sm text-slate-300">
              <div>
                {batchResult.running ? "Processing" : "Completed"} {batchResult.current} of {batchResult.total}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {batchResult.success} succeeded, {batchResult.failed} failed
              </div>
              {batchResult.errors.length > 0 && (
                <div className="mt-2 max-h-28 overflow-y-auto text-xs text-red-400">
                  {batchResult.errors.map((error, index) => <div key={index}>{error}</div>)}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            {batchResult?.running ? (
              <Button variant="danger" onClick={() => { stopBatchRef.current = true; }}>
                Stop
              </Button>
            ) : generatedDrafts ? (
              <>
                <Button variant="ghost" onClick={discardGeneratedDrafts}>Discard Results</Button>
                <Button onClick={saveGeneratedDrafts}>Save Results</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setBatchOpen(false)}>Cancel</Button>
                <Button disabled={!captionModelId} onClick={startBatchGeneration}>Generate</Button>
              </>
            )}
          </div>
        </Modal>
      )}
      {editorOpen && selectedItem && (
        <Modal
          wide
          title={`Sample Details · ${selected}`}
          onClose={() => setEditorOpen(false)}
        >
          <ItemEditor
            key={selected}
            item={selectedItem}
            datasetName={name}
            onSave={onSaveOne}
            onEditInputsChanged={reload}
            previewUrl={apiUrl(
              `/api/datasets/${encodeURIComponent(name)}/media/${encodeURIComponent(selected)}`,
            )}
            captionModels={captionModels}
            captionModelId={captionModelId}
            instruction={instruction}
            onModelChange={setCaptionModelId}
            onInstructionChange={setInstruction}
            onGeneratePrompt={async (modelId, requestInstruction, currentPrompt) => {
              const result = await api.generateDatasetPrompt(
                name, selected, modelId, requestInstruction, currentPrompt,
              );
              return result.prompt;
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" onMouseDown={onClose}>
      <div
        className={`max-h-[90vh] w-full ${wide ? "max-w-6xl" : "max-w-xl"} overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-5 shadow-2xl`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          <button type="button" className="text-xl text-slate-400 hover:text-white" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ItemEditor({
  item,
  datasetName,
  onSave,
  onEditInputsChanged,
  previewUrl,
  captionModels,
  captionModelId,
  instruction,
  onModelChange,
  onInstructionChange,
  onGeneratePrompt,
}: {
  item: any;
  datasetName: string;
  onSave: (item: any) => Promise<void>;
  onEditInputsChanged: () => Promise<void>;
  previewUrl: string;
  captionModels: CaptionModel[];
  captionModelId: string;
  instruction: string;
  onModelChange: (model: string) => void;
  onInstructionChange: (instruction: string) => void;
  onGeneratePrompt: (modelId: string, instruction: string, currentPrompt: string) => Promise<string>;
}) {
  const mediaPath = getMediaPath(item);
  const [text, setText] = useState(String(item.prompt || ""));
  const [fields, setFields] = useState(() => Object.entries(item)
    .filter(([key]) => !["image", "video", "audio", "prompt"].includes(key))
    .map(([key, value]) => ({ key, type: inferFieldType(value), value })));
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [activeTab, setActiveTab] = useState<"prompt" | "metadata">("prompt");
  const initialized = useRef(false);
  const onSaveRef = useRef(onSave);
  const mediaFieldsRef = useRef(Object.fromEntries(Object.entries(item).filter(([key]) => ["image", "video", "audio"].includes(key))));
  const image = isImagePath(mediaPath);
  const video = isVideoPath(mediaPath);
  const audio = isAudioPath(mediaPath);
  const compatibleModels = captionModels.filter((model) => modelSupports(model, mediaField(mediaPath)));
  const currentRecord = {
    ...mediaFieldsRef.current,
    prompt: text,
    ...Object.fromEntries(fields.filter((field) => field.key.trim()).map((field) => [field.key.trim(), field.value])),
  };

  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  useEffect(() => {
    if (!initialized.current) { initialized.current = true; return; }
    const keys = fields.map((field) => field.key.trim());
    if (keys.some((key) => !key) || new Set(keys).size !== keys.length) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      const extras = Object.fromEntries(fields.map((field) => [field.key.trim(), field.value]));
      try {
        await onSaveRef.current({ ...mediaFieldsRef.current, prompt: text, ...extras });
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [fields, text]);

  async function generatePrompt() {
    setGenerating(true);
    setGenerateError("");
    try {
      setText(await onGeneratePrompt(captionModelId, instruction, text));
    } catch (error: any) {
      setGenerateError(`Failed to generate prompt: ${error.message || "Unknown error"}`);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="grid items-stretch gap-5 lg:grid-cols-2">
      {(image || video || audio) && (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-h-64 items-center justify-center bg-black/20">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={mediaPath} className="max-h-[320px] max-w-full object-contain" />
            ) : video ? (
              <video src={previewUrl} controls className="max-h-[320px] max-w-full" />
            ) : (
              <audio src={previewUrl} controls className="w-full" />
            )}
          </div>
          <div>
            <div className="mb-2 text-xs font-medium uppercase text-slate-400">Sample JSON</div>
            <pre className="max-h-72 overflow-auto border border-slate-800 bg-slate-950/60 p-3 text-xs leading-5 text-slate-300">{JSON.stringify(currentRecord, null, 2)}</pre>
          </div>
        </div>
      )}
      <div className="h-full lg:col-start-2">
      <div className="mb-4 flex items-center justify-between border-b border-slate-800">
        <div className="flex">
          {([['prompt', 'Prompt'], ['metadata', `Extra Inputs · ${fields.length}`]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`border-b-2 px-4 py-2 text-sm ${activeTab === value ? "border-blue-500 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}
              onClick={() => setActiveTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className={`pr-2 text-xs ${saveState === "error" ? "text-red-400" : "text-slate-500"}`}>
          {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}
        </span>
      </div>

      {activeTab === "prompt" && (
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-sm font-medium text-slate-200">Prompt</div>
            <textarea
              className="min-h-20 w-full"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <div className="mt-2 text-xs text-slate-500">
              Edit the prompt manually or generate one from the sample.
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-slate-950/30 p-4">
            <div className="mb-1 text-sm font-medium text-slate-200">
              Auto-Caption
            </div>

            {image || video || audio ? (
              <>
                <Field label="Captioning Model" required>
                  {compatibleModels.length > 0 ? (
                    <select className="w-full" value={captionModelId} onChange={(event) => onModelChange(event.target.value)}>
                      {compatibleModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.model_id}</option>)}
                    </select>
                  ) : (
                    <div className="flex items-center justify-between gap-3 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      <span>No compatible captioning model is configured.</span><Link href="/settings" className="shrink-0">Configure Models</Link>
                    </div>
                  )}
                </Field>

                <Field label="Instructions">
                  <textarea
                    className="min-h-20 w-full"
                    value={instruction}
                    onChange={(event) => onInstructionChange(event.target.value)}
                  />
                </Field>

                <div className="flex items-center gap-3">
                  <Button variant="outline" disabled={generating || !captionModelId} onClick={generatePrompt}>
                    {generating ? "Generating..." : text.trim() ? "Regenerate Prompt" : "Generate Prompt"}
                  </Button>
                  {generateError && (
                    <span className="text-xs text-red-400">
                      {generateError}
                      <Link href="/settings" className="ml-2 text-blue-400 hover:text-blue-300">Configure Models</Link>
                    </span>
                  )}
                </div>

                <div className="mt-3 text-xs text-slate-500">
                  The generated prompt will replace the current prompt.
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500">
                Automatic prompt generation is unavailable for this sample type.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "metadata" && <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-slate-200">Input Fields</div>
          <Button variant="outline" size="sm" onClick={() => setFields((current) => [...current, { key: "", type: "text", value: "" }])}>Add Input</Button>
        </div>
        <div className="space-y-3">
          {fields.map((field, index) => (
            <MetadataFieldRow key={index} field={field} datasetName={datasetName} mediaPath={mediaPath}
              onChange={(next: { key: string; type: string; value: unknown }) => setFields((current) => current.map((value, i) => i === index ? next : value))}
              onRemove={() => setFields((current) => current.filter((_, i) => i !== index))}
              onUploaded={async () => { await onEditInputsChanged(); }} />
          ))}
          {fields.length === 0 && <div className="text-xs text-slate-500">No extra inputs.</div>}
        </div>
      </div>}
      </div>
    </div>
  );
}

const FIELD_TYPES = [
  ["text", "Text"], ["file", "File"],
] as const;

function inferFieldType(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && (isImagePath(first) || isVideoPath(first) || isAudioPath(first)) ? "file" : "text";
}

function MetadataFieldRow({ field, onChange, onRemove, datasetName, mediaPath, onUploaded }: any) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const media = field.type !== "text";
  const accept = "image/*,video/*,audio/*";
  const values: string[] = Array.isArray(field.value) ? field.value : field.value ? [String(field.value)] : [];
  const mediaKind = values.length === 0 ? "" : isImagePath(values[0]) ? "image" : isVideoPath(values[0]) ? "video" : "audio";
  async function upload(files: FileList | null) {
    if (!files?.length || !field.key.trim()) return;
    setBusy(true); setError("");
    try {
      const incoming = Array.from(files);
      const incomingKinds = new Set(incoming.map((file) => file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "unknown"));
      if (incomingKinds.size !== 1 || incomingKinds.has("unknown") || (mediaKind && !incomingKinds.has(mediaKind))) {
        throw new Error("A file field cannot mix images, videos, and audio");
      }
      const result = await api.uploadDatasetFieldMedia(datasetName, mediaPath, field.key.trim(), incoming);
      const next = [...values, ...result.saved];
      onChange({ ...field, value: next.length === 1 ? next[0] : next });
      await onUploaded();
    } catch (e: any) { setError(e.message || "Upload failed"); }
    finally { setBusy(false); }
  }
  async function removeFile(file: string) {
    setBusy(true); setError("");
    try {
      await api.deleteDatasetFieldMedia(datasetName, mediaPath, field.key.trim(), [file]);
      const next = values.filter((value) => value !== file);
      onChange({ ...field, value: next.length === 0 ? "" : next.length === 1 ? next[0] : next });
      await onUploaded();
    } catch (e: any) { setError(e.message || "Delete failed"); }
    finally { setBusy(false); }
  }
  async function removeField() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (media && values.length > 0) {
        await api.deleteDatasetFieldMedia(datasetName, mediaPath, field.key.trim(), values);
        await onUploaded();
      }
      onRemove();
    } catch (e: any) { setError(e.message || "Failed to delete field"); }
    finally { setBusy(false); }
  }
  async function changeType(type: string) {
    if (type === field.type) return;
    setBusy(true); setError("");
    try {
      if (media && values.length > 0) {
        await api.deleteDatasetFieldMedia(datasetName, mediaPath, field.key.trim(), values);
        await onUploaded();
      }
      onChange({ ...field, type, value: "" });
    } catch (e: any) { setError(e.message || "Failed to change field type"); }
    finally { setBusy(false); }
  }
  return (
    <div className="border border-slate-800 bg-slate-950/30 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px_auto]">
        <input className="w-full" placeholder="Field key" value={field.key} onChange={(e) => onChange({ ...field, key: e.target.value })} />
        <select className="w-full" value={field.type} disabled={busy} onChange={(e) => changeType(e.target.value)}>
          {FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <Button variant="danger" size="sm" disabled={busy} onClick={removeField}>Delete</Button>
      </div>
      {media ? (
        <div className="mt-3">
          <label className="inline-flex cursor-pointer items-center border border-slate-700 px-3 py-2 text-xs text-slate-200">
            Choose Files
            <input type="file" className="hidden" accept={accept} multiple disabled={busy || !field.key.trim()} onChange={(e) => upload(e.target.files)} />
          </label>
          {values.length > 0 && <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {values.map((file) => <div key={file} className="overflow-hidden border border-slate-800 bg-slate-950">
              {isImagePath(file) ? <img src={apiUrl(`/api/datasets/${encodeURIComponent(datasetName)}/media/${encodeURIComponent(file)}`)} alt={file} className="aspect-video w-full object-cover" />
                : isVideoPath(file) ? <video src={apiUrl(`/api/datasets/${encodeURIComponent(datasetName)}/media/${encodeURIComponent(file)}`)} controls className="aspect-video w-full object-cover" />
                  : <audio src={apiUrl(`/api/datasets/${encodeURIComponent(datasetName)}/media/${encodeURIComponent(file)}`)} controls className="w-full" />}
              <div className="flex items-center justify-between gap-2 p-2 text-[10px]"><span className="truncate">{file.split("/").pop()}</span><button className="text-red-400" onClick={() => removeFile(file)}>Delete</button></div>
            </div>)}
          </div>}
        </div>
      ) : (
        <textarea className="mt-3 min-h-15 w-full" value={typeof field.value === "string" ? field.value : JSON.stringify(field.value)} onChange={(e) => onChange({ ...field, value: e.target.value })} />
      )}
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}

function MetadataTable({
  items,
  disabled,
  onSave,
}: {
  items: any[];
  disabled: boolean;
  onSave: (items: any[]) => void;
}) {
  const [text, setText] = useState(items.map((item) => JSON.stringify(item)).join("\n"));
  useEffect(() => {
    setText(items.map((item) => JSON.stringify(item)).join("\n"));
  }, [items]);
  function saveAll() {
    let parsed: any[];
    try {
      parsed = parseMetadataText(text);
    } catch (error: any) {
      alert("Metadata is not valid JSON: " + error.message);
      return;
    }
    if (confirm(`Save all ${parsed.length} metadata records?`)) onSave(parsed);
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/30 px-4 py-3">
        <div className="text-sm font-semibold text-slate-100">metadata.jsonl</div>
        <Button variant="outline" size="sm" disabled={disabled} onClick={saveAll}>
          Save All metadata.jsonl
        </Button>
      </div>
      <div className="p-3 sm:p-4">
        <textarea
          className="h-32 w-full resize-none overflow-y-auto mono text-xs"
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
    </div>
  );
}

function getMediaPath(item: any): string {
  return String(item.image || item.video || item.audio || item.file_name || item.path || "").replaceAll("\\", "/");
}

function normalizeMediaPath(path: string): string {
  return String(path || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|bmp)$/i.test(path);
}

function isVideoPath(path: string): boolean {
  return /\.(mp4|webm|mov|mkv|avi)$/i.test(path);
}

function isAudioPath(path: string): boolean {
  return /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(path);
}

function formatMediaDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function VideoCardPreview({ src, className }: { src: string; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState("--:--");
  return (
    <div className={`relative ${className} w-full shrink-0 overflow-hidden bg-slate-800`}>
      <video
        ref={ref}
        src={src}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
        onLoadedMetadata={(event) => {
          setDuration(formatMediaDuration(event.currentTarget.duration));
          event.currentTarget.currentTime = 0;
        }}
        onLoadedData={(event) => { event.currentTarget.currentTime = 0; }}
        onMouseEnter={() => { void ref.current?.play(); }}
        onMouseLeave={() => {
          if (ref.current) { ref.current.pause(); ref.current.currentTime = 0; }
        }}
      />
      <div className="pointer-events-none absolute bottom-1 left-1 right-1 flex items-center justify-between text-[10px] text-white drop-shadow">
        <span className="bg-black/60 px-1.5 py-0.5">Video</span>
        <span className="bg-black/60 px-1.5 py-0.5">{duration}</span>
      </div>
    </div>
  );
}

function AudioCardPreview({ src, className }: { src: string; className: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  function stop(event: React.SyntheticEvent) { event.stopPropagation(); }
  async function toggle(event: React.MouseEvent) {
    stop(event);
    if (!ref.current) return;
    if (ref.current.paused) await ref.current.play();
    else ref.current.pause();
  }
  return (
    <div className={`flex ${className} w-full shrink-0 flex-col justify-center gap-2 bg-slate-800 px-3`}>
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPosition(0); }}
      />
      <div className="flex items-center gap-2 text-xs text-slate-200">
        <button type="button" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-950 hover:bg-slate-700" onClick={toggle} aria-label={playing ? "Pause audio" : "Play audio"}>
          {playing ? "||" : ">"}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step="any"
          value={Math.min(position, duration || 0)}
          className="min-w-0 flex-1 accent-blue-400"
          onClick={stop}
          onChange={(event) => {
            stop(event);
            const next = Number(event.target.value);
            if (ref.current) ref.current.currentTime = next;
            setPosition(next);
          }}
          aria-label="Audio progress"
        />
        <span className="w-10 text-right text-[10px] text-slate-300">{formatMediaDuration(playing ? position : duration)}</span>
      </div>
      <div className="text-center text-[10px] uppercase tracking-wide text-slate-400">Audio</div>
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMetadataText(text: string): any[] {
  const content = text.trim();
  if (!content) return [];
  try {
    const value = JSON.parse(content);
    const items = Array.isArray(value) ? value : [value];
    if (!items.every(isJsonObject)) throw new Error("Every metadata record must be a JSON object");
    return items;
  } catch (error) {
    if (content.startsWith("[")) throw error;
  }
  return content.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const item = JSON.parse(line);
      if (!isJsonObject(item)) throw new Error("Must be a JSON object");
      return [item];
    } catch (error: any) {
      throw new Error(`Line ${index + 1} is not valid JSON: ${error.message}`);
    }
  });
}
