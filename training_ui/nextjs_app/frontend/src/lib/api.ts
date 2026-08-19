import { apiUrl } from "@/lib/basePath";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");

function resolve(url: string): string {
  if (API_BASE && url.startsWith("/api/")) {
    return API_BASE + url;
  }
  return apiUrl(url);
}

async function req<T = any>(url: string, init?: RequestInit): Promise<T> {
  let resolvedUrl = resolve(url);
  if (!init?.method || init.method.toUpperCase() === "GET") {
    resolvedUrl += `${resolvedUrl.includes("?") ? "&" : "?"}_ts=${Date.now()}`;
  }
  const resp = await fetch(resolvedUrl, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!resp.ok) {
    const text = await resp.text();
    let message = text;
    try {
      const payload = JSON.parse(text);
      if (typeof payload?.detail === "string") message = payload.detail;
      else if (typeof payload?.message === "string") message = payload.message;
    } catch {
    }
    throw new Error(message || `${resp.status} ${resp.statusText}`);
  }
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await resp.json()) as T;
  }
  return (await resp.text()) as unknown as T;
}

export const api = {
  meta: () => req<any>("/api/meta"),
  gpu: () => req<any>("/api/gpu"),
  recipes: () => req<{ recipes: any[] }>("/api/recipes"),

  listDatasets: (page = 1, pageSize = 20) =>
    req<{ datasets: any[]; page: number; page_size: number; total: number; pages: number }>(
      `/api/datasets?page=${page}&page_size=${pageSize}`,
    ),
  createDataset: (name: string, kind: string) =>
    req<any>("/api/datasets", { method: "POST", body: JSON.stringify({ name, kind }) }),
  deleteDataset: (name: string) =>
    req<any>(`/api/datasets/${encodeURIComponent(name)}`, { method: "DELETE" }),
  datasetDetail: (name: string) => req<any>(`/api/datasets/${encodeURIComponent(name)}`),
  saveMetadata: (name: string, items: any[]) =>
    req<any>(`/api/datasets/${encodeURIComponent(name)}/metadata`, {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),
  generateDatasetPrompt: (
    name: string,
    mediaPath: string,
    captionModelId: string,
    instruction: string,
    currentPrompt: string,
  ) =>
    req<{ prompt: string }>(
      `/api/datasets/${encodeURIComponent(name)}/generate_prompt`,
      {
        method: "POST",
        body: JSON.stringify({
          media_path: mediaPath,
          caption_model_id: captionModelId,
          instruction,
          current_prompt: currentPrompt,
        }),
      },
    ),
  uploadFiles: async (name: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    const resp = await fetch(resolve(`/api/datasets/${encodeURIComponent(name)}/upload`), {
      method: "POST",
      body: form,
    });
    if (!resp.ok) {
      const detail = (await resp.text()).trim();
      if (resp.status === 413) {
        throw new Error("The total file size exceeds the server upload limit");
      }
      if (resp.status >= 500) {
        throw new Error(
          detail && detail !== "Internal Server Error"
            ? detail
            : "The server failed to process the upload. Check the upload limit or server logs.",
        );
      }
      throw new Error(detail || `${resp.status} ${resp.statusText}`);
    }
    return resp.json();
  },
  deleteDatasetMedia: (name: string, files: string[]) =>
    req<{ deleted: string[] }>(`/api/datasets/${encodeURIComponent(name)}/media`, {
      method: "DELETE",
      body: JSON.stringify({ files }),
    }),
  uploadDatasetEditInputs: async (name: string, mediaPath: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const resp = await fetch(
      resolve(
        `/api/datasets/${encodeURIComponent(name)}/media/${encodeURIComponent(mediaPath)}/edit-inputs`,
      ),
      { method: "POST", body: form },
    );
    if (!resp.ok) throw new Error((await resp.text()).trim() || `${resp.status} ${resp.statusText}`);
    return resp.json() as Promise<{ saved: string[] }>;
  },
  deleteDatasetEditInputs: (name: string, mediaPath: string, files: string[]) =>
    req<{ deleted: string[] }>(
      `/api/datasets/${encodeURIComponent(name)}/media/${encodeURIComponent(mediaPath)}/edit-inputs`,
      { method: "DELETE", body: JSON.stringify({ files }) },
    ),
  uploadDatasetFieldMedia: async (name: string, mediaPath: string, field: string, files: File[]) => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    const resp = await fetch(resolve(`/api/datasets/${encodeURIComponent(name)}/media/${encodeURIComponent(mediaPath)}/fields/${encodeURIComponent(field)}`), { method: "POST", body: form });
    if (!resp.ok) throw new Error((await resp.text()).trim() || `${resp.status} ${resp.statusText}`);
    return resp.json() as Promise<{ saved: string[] }>;
  },
  deleteDatasetFieldMedia: (name: string, mediaPath: string, field: string, files: string[]) =>
    req<{ deleted: string[] }>(`/api/datasets/${encodeURIComponent(name)}/media/${encodeURIComponent(mediaPath)}/fields/${encodeURIComponent(field)}`, { method: "DELETE", body: JSON.stringify({ files }) }),

  listTasks: (page = 1, pageSize = 20, status = "all") =>
    req<{ tasks: any[]; page: number; page_size: number; total: number; pages: number; counts: { all: number; running: number; history: number } }>(
      `/api/tasks?page=${page}&page_size=${pageSize}&status=${encodeURIComponent(status)}`,
    ),
  createTask: (name: string, config: any, startNow: boolean) =>
    req<any>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ name, config, start_now: startNow }),
    }),
  updateTask: (id: string, name: string, config: any) =>
    req<any>(`/api/tasks/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, config }),
    }),
  uploadSamplingInputs: async (
    taskId: string,
    sampleId: string,
    fieldName: string,
    files: File[],
  ) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const resp = await fetch(
      resolve(
        `/api/tasks/${encodeURIComponent(taskId)}/sampling-inputs/${encodeURIComponent(sampleId)}/${encodeURIComponent(fieldName)}`,
      ),
      { method: "POST", body: form },
    );
    if (!resp.ok) throw new Error((await resp.text()).trim() || `${resp.status} ${resp.statusText}`);
    return resp.json() as Promise<{ saved: string[] }>;
  },
  getTask: (id: string) => req<any>(`/api/tasks/${id}`),
  startTask: (id: string) => req<any>(`/api/tasks/${id}/start`, { method: "POST" }),
  stopTask: (id: string) => req<any>(`/api/tasks/${id}/stop`, { method: "POST" }),
  deleteTask: (id: string) => req<any>(`/api/tasks/${id}`, { method: "DELETE" }),
  taskLog: (id: string) => req<string>(`/api/tasks/${id}/log`),
  taskSamples: (id: string) => req<{ samples: string[] }>(`/api/tasks/${id}/samples`),
  taskSamplingStatus: (id: string) => req<any>(`/api/tasks/${id}/sampling_status`),
  taskCheckpoints: (id: string) => req<{ checkpoints: any[] }>(`/api/tasks/${id}/checkpoints`),
  taskLoss: (id: string) => req<{ series: any[] }>(`/api/tasks/${id}/loss`),
  previewCommand: (config: any) =>
    req<any>("/api/preview_command", { method: "POST", body: JSON.stringify({ config }) }),

  getSettings: () => req<any>("/api/settings"),
  setSettings: (settings: Record<string, string>) =>
    req<any>("/api/settings", { method: "PUT", body: JSON.stringify({ settings }) }),
  listCaptionModels: () => req<{ models: any[] }>("/api/caption-models"),
  createCaptionModel: (model: any) =>
    req<any>("/api/caption-models", { method: "POST", body: JSON.stringify(model) }),
  updateCaptionModel: (id: string, model: any) =>
    req<any>(`/api/caption-models/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(model),
    }),
  deleteCaptionModel: (id: string) =>
    req<any>(`/api/caption-models/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
