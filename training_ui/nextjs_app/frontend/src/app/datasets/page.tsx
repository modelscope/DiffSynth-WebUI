"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, Card, EmptyState, Field, PageHeader } from "@/components/ui";

const KINDS = ["image", "video", "audio"];

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("image");
  const [msg, setMsg] = useState("");
  const [createError, setCreateError] = useState("");

  async function reload() {
    try {
      const r = await api.listDatasets(page, pageSize);
      setDatasets(r.datasets || []);
      setTotal(r.total || 0);
      setPages(r.pages || 0);
    } catch (e: any) {
      setMsg("Failed to load: " + e.message);
    }
  }
  useEffect(() => {
    reload();
  }, [page, pageSize]);

  async function onCreate() {
    if (!newName.trim()) {
      setCreateError("Enter a dataset name");
      return;
    }
    setCreateError("");
    try {
      await api.createDataset(newName.trim(), newKind);
      setMsg("");
      setNewName("");
      reload();
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("already exists")) {
        setCreateError("The dataset already exists. Choose another name.");
      } else {
        setCreateError("Failed to create the dataset. Try again later.");
      }
    }
  }

  async function onDelete(name: string) {
    if (!confirm(`Delete dataset [${name}]?`)) return;
    try {
      await api.deleteDataset(name);
      setMsg("");
      reload();
    } catch (e: any) {
      setMsg("Failed to delete: " + e.message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl p-3 sm:p-4 lg:p-6">
      <PageHeader title="Datasets" />

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card title="Create Dataset">
          <Field label="Dataset Name" required>
            <input
              className="w-full"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </Field>
          <Field label="Dataset Type">
            <select className="w-full" value={newKind} onChange={(e) => setNewKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <div className="mt-3 flex items-end gap-3">
            {createError && <div className="text-xs text-red-400">{createError}</div>}
            <Button onClick={onCreate}>+ Create Dataset</Button>
          </div>
        </Card>

        <Card title="Dataset List" padded={false}>
          {datasets.length === 0 ? (
            <div className="py-6">
              <EmptyState
                title="No datasets yet"
                hint="Enter a name and select a type to create your first dataset"
              />
            </div>
          ) : (
            <table className="min-w-[620px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Samples</th>
                  <th className="w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((d) => (
                  <tr key={d.name}>
                    <td>
                      <Link
                        href={`/datasets/${encodeURIComponent(d.name)}`}
                        className="text-blue-300 hover:underline"
                      >
                        {d.name}
                      </Link>
                    </td>
                    <td className="text-slate-300">{d.kind}</td>
                    <td className="text-slate-300 mono">{d.num_items}</td>
                    <td>
                      <div className="flex gap-2">
                        <Link href={`/datasets/${encodeURIComponent(d.name)}`}>
                          <Button variant="outline" size="sm">
                            Open
                          </Button>
                        </Link>
                        <Button variant="danger" size="sm" onClick={() => onDelete(d.name)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-xs text-slate-300">
              <span>Page {page} of {pages} ({total} datasets)</span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2">Per page
                  <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="w-20">
                    {[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
