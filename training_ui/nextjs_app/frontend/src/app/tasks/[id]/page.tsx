"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { apiUrl } from "@/lib/basePath";
import { formatDateTime, formatShellCommand } from "@/lib/format";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  Tabs,
} from "@/components/ui";
import { LossChart } from "@/components/LossChart";

const WEIGHT_EXTENSIONS = new Set([
  ".safetensors", ".pt", ".pth", ".bin", ".ckpt", ".onnx", ".gguf", ".pkl", ".pickle",
]);
const TEXT_EXTENSIONS = new Set([
  ".txt", ".log", ".json", ".jsonl", ".csv", ".tsv", ".yaml", ".yml", ".md",
  ".py", ".sh", ".toml", ".ini", ".cfg", ".xml", ".html", ".htm",
]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi"]);
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"]);

function fileExtension(path: string) {
  const name = path.toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;
  return `${(megabytes / 1024).toFixed(2)} GB`;
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const taskId = params.id;

  const [tab, setTab] = useState<"overview" | "log" | "files" | "config">("overview");
  const [task, setTask] = useState<any>(null);
  const [log, setLog] = useState<string>("");
  const [samples, setSamples] = useState<any[]>([]);
  const [checkpoints, setCheckpoints] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [loss, setLoss] = useState<any[]>([]);
  const [samplingStatus, setSamplingStatus] = useState<any>({ status: "not_started" });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [msg, setMsg] = useState("");
  const [previewFile, setPreviewFile] = useState<any>(null);
  const [previewText, setPreviewText] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  async function openFilePreview(file: any) {
    setPreviewFile(file);
    setPreviewText("");
    setPreviewError("");
    const extension = fileExtension(file.rel_path);
    if (!TEXT_EXTENSIONS.has(extension)) return;
    setPreviewLoading(true);
    try {
      const response = await fetch(
        apiUrl(`/api/tasks/${taskId}/artifact?path=${encodeURIComponent(file.rel_path)}`),
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      setPreviewText(await response.text());
    } catch (error: any) {
      setPreviewError(error.message || "Failed to load preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function reloadCore() {
    try {
      const j = await api.getTask(taskId);
      setTask(j);
      const l = await api.taskLog(taskId);
      setLog(l);
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function reloadArtifacts() {
    const [s, sampling, c, f, ls] = await Promise.all([
      api.taskSamples(taskId).catch(() => null),
      api.taskSamplingStatus(taskId).catch(() => null),
      api.taskCheckpoints(taskId).catch(() => null),
      (async () => {
        try {
          const separator = apiUrl(`/api/tasks/${taskId}/files`).includes("?") ? "&" : "?";
          const r = await fetch(
            `${apiUrl(`/api/tasks/${taskId}/files`)}${separator}_ts=${Date.now()}`,
            { cache: "no-store" },
          );
          if (!r.ok) return null;
          return r.json();
        } catch {
          return null;
        }
      })(),
      api.taskLoss(taskId).catch(() => null),
    ]);
    if (s) setSamples(s.samples || []);
    if (sampling) setSamplingStatus(sampling);
    if (c) setCheckpoints(c.checkpoints || []);
    if (f) setFiles((f as any).files || []);
    if (ls) setLoss(ls.series || []);
  }

  useEffect(() => {
    reloadCore();
    reloadArtifacts();
  }, [taskId]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      reloadCore();
      reloadArtifacts();
    }, 2500);
    return () => clearInterval(timer);
  }, [autoRefresh, taskId]);

  if (!task) {
    return (
      <div className="p-3 text-slate-400 sm:p-4 lg:p-6">
        Loading... {msg && <div className="text-red-400 mt-2">{msg}</div>}
      </div>
    );
  }

  const cmd = (task.command || []) as string[];
  const runConfig = task.latest_run?.config || task.config;
  const shellCmd = formatShellCommand(cmd);
  const latestLoss = loss.length > 0 ? loss[loss.length - 1] : null;

  return (
    <div className="mx-auto w-full max-w-screen-2xl p-3 sm:p-4 lg:p-6">
      <PageHeader
        title={task.name}
        subtitle={
          <>
            <span className="mr-2">
              <StatusBadge status={task.status} />
            </span>
          </>
        }
        actions={
          <>
            <label className="flex items-center gap-1 text-xs text-slate-400 mr-2">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto Refresh
            </label>
            {!autoRefresh && (
              <Button
                variant="outline"
                onClick={() => {
                  reloadCore();
                  reloadArtifacts();
                }}
              >
                Refresh
              </Button>
            )}
            {!["running", "preparing", "sampling"].includes(task.status) && (
              <>
                <Link href={`/tasks/new?edit=${encodeURIComponent(task.id)}`}>
                  <Button variant="outline">Edit</Button>
                </Link>
                <Button
                  onClick={async () => {
                    await api.startTask(task.id);
                    reloadCore();
                  }}
                >
                  Start
                </Button>
              </>
            )}
            {["running", "preparing", "sampling"].includes(task.status) && (
              <Button
                variant="danger"
                onClick={async () => {
                  await api.stopTask(task.id);
                  reloadCore();
                }}
              >
                Stop
              </Button>
            )}
            <Link href="/tasks">
              <Button variant="ghost" size="sm">
                ← Back to List
              </Button>
            </Link>
          </>
        }
      />

      <Tabs
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "log", label: "Logs" },
          { key: "files", label: "Files", count: files.length },
          { key: "config", label: "Config & Command" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as any)}
      />

      {task.status === "unknown" && (
        <div className="mb-4 rounded border border-violet-500/40 bg-violet-500/10 px-4 py-3 text-sm text-violet-200">
          The training process has exited, but the backend could not recover its exit code. Check the full logs and outputs before restarting.
        </div>
      )}

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Card
              title="Loss Curve"
              subtitle={
                latestLoss
                  ? `Latest step ${latestLoss.step} · loss ${Number(latestLoss.loss).toFixed(6)}`
                  : undefined
              }
            >
              <LossChart data={loss.map((p: any) => ({ step: p.step, loss: p.loss }))} />
            </Card>
            <Card title="Output Summary">
              <MetricRow label="Checkpoints" value={checkpoints.length} />
              <MetricRow label="Final Samples" value={samples.length} />
              <MetricRow label="Other Files" value={files.length} />
              <div className="mt-3 text-[11px] text-slate-400 space-y-1">
                <div>
                  <span className="text-slate-400">output_path:</span>{" "}
                  <code className="text-slate-300">{task.output_path || "-"}</code>
                </div>
                <div>
                  <span className="text-slate-400">GPU:</span>{" "}
                  <code className="text-slate-300">GPU {runConfig?.gpu_index ?? 0}</code>
                </div>
                <div className="text-slate-400">
                  Created {formatDateTime(task.created_at)} · Started {formatDateTime(task.started_at)} · Ended{" "}
                  {formatDateTime(task.finished_at)}
                </div>
              </div>
            </Card>
          </div>

          <Card
            title="Checkpoints"
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  api.taskCheckpoints(taskId).then((r) => setCheckpoints(r.checkpoints || []))
                }
              >
                Refresh
              </Button>
            }
            padded={false}
          >
            {checkpoints.length === 0 ? (
              <div className="py-6">
                <EmptyState title="No checkpoints"/>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th className="w-32">Size</th>
                    <th className="w-40">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {checkpoints.map((c) => (
                    <tr key={c.rel_path}>
                      <td className="text-slate-200 mono text-xs">{c.rel_path}</td>
                      <td className="text-slate-400 mono text-xs">
                        {formatFileSize(c.size)}
                      </td>
                      <td>
                        <a
                          href={apiUrl(
                            `/api/tasks/${taskId}/artifact?path=${encodeURIComponent(c.rel_path)}&download=true`,
                          )}
                          download={c.rel_path.split("/").pop()}
                        >
                          <Button variant="outline" size="sm">
                            Download
                          </Button>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card
            title={`Final Sampling`}
            subtitle={
              samplingStatus.checkpoint
                ? `Using ${String(samplingStatus.checkpoint).split("/").pop()}`
                : "Samples with the final .safetensors file and test prompts after training"
            }
            actions={<SamplingState status={samplingStatus.status} />}
          >
            {samplingStatus.status === "failed" && (
              <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {samplingStatus.message || "Final sampling failed. Check the logs under final_samples."}
              </div>
            )}
            {samples.length === 0 ? (
              <EmptyState
                title={
                  samplingStatus.status === "running" || samplingStatus.status === "queued"
                    ? "Generating final samples"
                    : "No final samples"
                }
                hint={
                  samplingStatus.status === "running" || samplingStatus.status === "queued"
                    ? samplingStatus.current
                      ? `Generating prompt ${samplingStatus.current} / ${samplingStatus.total || 0}`
                      : `Sampling queued for ${samplingStatus.total || 0} prompts`
                    : undefined
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {samples.map((sample) => (
                  <SamplePreview key={sample.rel_path} taskId={taskId} sample={sample} />
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "log" && (
        <Card title="Training Logs">
          <pre
            className="text-xs whitespace-pre-wrap mono bg-black/60 rounded-lg p-3 max-h-[560px] overflow-y-auto text-slate-200"
          >
            {log || "No logs"}
          </pre>
        </Card>
      )}

      {tab === "files" && (
        <Card title={`Output Files (${files.length})`} padded={false}>
          {files.length === 0 ? (
            <div className="py-6">
              <EmptyState title="No outputs"/>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Path</th>
                  <th className="w-32">Size</th>
                  <th className="w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => {
                  const weightFile = WEIGHT_EXTENSIONS.has(fileExtension(f.rel_path));
                  return (
                    <tr key={f.rel_path}>
                      <td className="text-slate-200 mono text-xs">{f.rel_path}</td>
                      <td className="text-slate-400 mono text-xs">
                        {formatFileSize(f.size)}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          {!weightFile && (
                            <Button variant="outline" size="sm" onClick={() => openFilePreview(f)}>
                              Preview
                            </Button>
                          )}
                          <a
                            href={apiUrl(
                              `/api/tasks/${taskId}/artifact?path=${encodeURIComponent(f.rel_path)}&download=true`,
                            )}
                          >
                            <Button variant="outline" size="sm">
                              Download
                            </Button>
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "config" && (
        <div className="space-y-4">
          <Card title="Launch Command">
            <pre className="text-xs whitespace-pre-wrap break-words mono text-slate-300 overflow-x-auto">
              {shellCmd || "(Not started)"}
            </pre>
          </Card>
          <Card title="Task Configuration">
            <pre className="text-xs whitespace-pre-wrap mono text-slate-300 max-h-[400px] overflow-y-auto">
              {JSON.stringify(runConfig, null, 2)}
            </pre>
          </Card>
        </div>
      )}

      {previewFile && (
        <ArtifactPreviewModal
          taskId={taskId}
          file={previewFile}
          text={previewText}
          loading={previewLoading}
          error={previewError}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}

function ArtifactPreviewModal({
  taskId,
  file,
  text,
  loading,
  error,
  onClose,
}: {
  taskId: string;
  file: any;
  text: string;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const extension = fileExtension(file.rel_path);
  const src = apiUrl(`/api/tasks/${taskId}/artifact?path=${encodeURIComponent(file.rel_path)}`);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6" onClick={onClose}>
      <div
        className="flex h-[82vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-4 py-3">
          <div className="min-w-0 truncate text-sm font-medium text-slate-100">{file.rel_path}</div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/35 p-4">
          {loading ? (
            <div className="text-sm text-slate-400">Loading preview...</div>
          ) : error ? (
            <div className="text-sm text-red-400">{error}</div>
          ) : TEXT_EXTENSIONS.has(extension) ? (
            <pre className="h-full w-full overflow-auto whitespace-pre-wrap break-words rounded bg-black/50 p-4 text-xs text-slate-200 mono">
              {text}
            </pre>
          ) : IMAGE_EXTENSIONS.has(extension) ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={file.rel_path} className="max-h-full max-w-full object-contain" />
            </>
          ) : VIDEO_EXTENSIONS.has(extension) ? (
            <video src={src} className="max-h-full max-w-full" controls preload="metadata" />
          ) : AUDIO_EXTENSIONS.has(extension) ? (
            <audio src={src} className="w-full max-w-2xl" controls preload="metadata" />
          ) : extension === ".pdf" ? (
            <iframe src={src} title={file.rel_path} className="h-full w-full bg-white" />
          ) : (
            <iframe src={src} title={file.rel_path} className="h-full w-full bg-white" sandbox="" />
          )}
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-800 last:border-b-0">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-sm text-slate-100 mono">{value}</span>
    </div>
  );
}

function SamplingState({ status }: { status: string }) {
  const labels: Record<string, string> = {
    not_started: "Waiting for training",
    queued: "Waiting to sample",
    running: "Sampling",
    finished: "Sampling completed",
    failed: "Sampling failed",
    skipped: "Skipped",
    stopped: "Stopped",
  };
  const classes: Record<string, string> = {
    queued: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    running: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    finished: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    failed: "border-red-500/30 bg-red-500/10 text-red-300",
    skipped: "border-slate-700 bg-slate-800 text-slate-300",
    stopped: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    not_started: "border-slate-700 bg-slate-800 text-slate-300",
  };
  return (
    <span className={`rounded-md border px-2 py-1 text-[11px] ${classes[status] || classes.not_started}`}>
      {labels[status] || status}
    </span>
  );
}

function SamplePreview({ taskId, sample }: { taskId: string; sample: any }) {
  const src = apiUrl(
    `/api/tasks/${taskId}/artifact?path=${encodeURIComponent(sample.rel_path)}`,
  );
  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
      {sample.kind === "video" ? (
        <video className="aspect-video w-full bg-black object-contain" src={src} controls preload="metadata" />
      ) : sample.kind === "audio" ? (
        <div className="flex min-h-28 items-center bg-slate-950/70 px-3">
          <audio className="w-full" src={src} controls preload="metadata" />
        </div>
      ) : (
        <a href={src} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={sample.prompt || sample.name} className="aspect-[1/1] w-full object-cover" />
        </a>
      )}
      <div className="space-y-1 border-t border-slate-800 px-2.5 py-2">
        {sample.prompt && <div className="line-clamp-2 text-xs text-slate-400">{sample.prompt}</div>}
      </div>
    </div>
  );
}
