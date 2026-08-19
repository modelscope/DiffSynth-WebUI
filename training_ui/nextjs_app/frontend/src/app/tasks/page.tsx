"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Button, Card, EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";

export default function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [filter, setFilter] = useState<"all" | "running" | "history">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [counts, setCounts] = useState({ all: 0, running: 0, history: 0 });
  const [msg, setMsg] = useState("");

  async function reload() {
    try {
      const r = await api.listTasks(page, pageSize, filter);
      setTasks(r.tasks || []);
      setTotal(r.total || 0);
      setPages(r.pages || 0);
      setCounts(r.counts || { all: 0, running: 0, history: 0 });
    } catch (e: any) {
      setMsg("Failed to load: " + e.message);
    }
  }

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [filter, page, pageSize]);

  return (
    <div className="mx-auto w-full max-w-screen-2xl p-3 sm:p-4 lg:p-6">
      <PageHeader
        title="Tasks"
        actions={
          <>
            <Link href="/tasks/new">
              <Button>+ New Task</Button>
            </Link>
          </>
        }
      />

      <Tabs
        tabs={[
          { key: "all", label: "All", count: counts.all },
          { key: "running", label: "Running", count: counts.running },
          { key: "history", label: "Finished", count: counts.history },
        ]}
        active={filter}
        onChange={(key) => {
          setFilter(key as "all" | "running" | "history");
          setPage(1);
        }}
      />

      {msg && <div className="text-xs text-red-400 mb-2">{msg}</div>}

      <Card padded={false}>
        {tasks.length === 0 ? (
          <div className="py-8">
            <EmptyState
              title="No tasks"
              hint="Click New Task in the top-right corner to begin"
              action={
                <Link href="/tasks/new">
                  <Button>+ Create Now</Button>
                </Link>
              }
            />
          </div>
        ) : (
          <table className="min-w-[860px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Model</th>
                <th>Dataset</th>
                <th>GPU</th>
                <th>Status</th>
                <th>Created At</th>
                <th className="w-52">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((j) => (
                <tr key={j.id}>
                  <td>
                    <Link href={`/tasks/${j.id}`} className="text-blue-300 hover:underline font-medium">
                      {j.name}
                    </Link>
                  </td>
                  <td className="text-slate-300">{j.model_type}</td>
                  <td className="text-slate-400">{j.dataset}</td>
                  <td className="text-slate-300 mono">{j.config?.gpu_index ?? 0}</td>
                  <td>
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="text-slate-400 mono text-xs">
                    {formatDateTime(j.created_at)}
                  </td>
                  <td>
                    <div className="flex gap-2">
                      {!["running", "preparing", "sampling"].includes(j.status) && (
                        <>
                          <Link href={`/tasks/new?edit=${encodeURIComponent(j.id)}`}>
                            <Button variant="outline" size="sm">Edit</Button>
                          </Link>
                          <Button
                            size="sm"
                            onClick={async () => {
                              await api.startTask(j.id);
                              reload();
                            }}
                          >
                            Start
                          </Button>
                        </>
                      )}
                      {["running", "preparing", "sampling"].includes(j.status) && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={async () => {
                            await api.stopTask(j.id);
                            reload();
                          }}
                        >
                          Stop
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (!confirm(`Delete task "${j.name}" and all of its process history and outputs?`)) return;
                          await api.deleteTask(j.id);
                          reload();
                        }}
                      >
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
            <span>Page {page} of {pages} ({total} tasks)</span>
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
  );
}
