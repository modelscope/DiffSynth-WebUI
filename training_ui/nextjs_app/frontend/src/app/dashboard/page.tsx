"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GpuMonitor } from "@/components/GpuMonitor";
import { Button, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const ACTIVE_STATUSES = new Set(["preparing", "running", "sampling"]);

export default function DashboardPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [error, setError] = useState("");

  async function reload() {
    try {
      const [taskResult, datasetResult] = await Promise.all([
        api.listTasks(1, 1000),
        api.listDatasets(1, 1000),
      ]);
      setTasks(taskResult.tasks || []);
      setDatasets(datasetResult.datasets || []);
      setError("");
    } catch (err: any) {
      setError(`Failed to load dashboard: ${err?.message || "Unable to connect to the backend"}`);
    }
  }

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, []);

  const summary = useMemo(() => {
    const active = tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).length;
    const waiting = tasks.filter((task) => task.status === "created").length;
    const finished = tasks.filter((task) => task.status === "finished").length;
    return { active, waiting, finished };
  }, [tasks]);

  const recentTasks = tasks.slice(0, 10);

  return (
    <div className="mx-auto w-full max-w-screen-2xl p-6">
      <PageHeader
        title="Dashboard"
        actions={
          <Link href="/tasks/new">
            <Button>+ New Task</Button>
          </Link>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="mb-4 grid grid-cols-4 gap-4">
        <Metric label="Running" value={summary.active} tone="blue" href="/tasks" />
        <Metric label="Pending" value={summary.waiting} tone="amber" href="/tasks" />
        <Metric label="Completed" value={summary.finished} tone="emerald" href="/tasks" />
        <Metric label="Datasets" value={datasets.length} tone="cyan" href="/datasets" />
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_400px] items-stretch gap-4">
        <Card
          title="Recent Tasks"
          className="h-full"
          actions={
            <Link href="/tasks">
              <Button variant="ghost" size="sm">View All →</Button>
            </Link>
          }
          padded={false}
        >
          {recentTasks.length === 0 ? (
            <EmptyState
              title="No training tasks yet"
              action={
                <Link href="/tasks/new">
                  <Button>+ New Task</Button>
                </Link>
              }
            />
          ) : (
            <table className="min-w-[750px] leading-5">
              <thead>
                <tr>
                  <th>Task Name</th>
                  <th>Model</th>
                  <th>Dataset</th>
                  <th>Status</th>
                  <th>Created At</th>
                </tr>
              </thead>
              <tbody>
                {recentTasks.map((task) => (
                  <tr key={task.id} className="h-12">
                    <td>
                      <Link href={`/tasks/${task.id}`} className="font-medium text-blue-300 hover:underline">
                        {task.name}
                      </Link>
                    </td>
                    <td className="text-slate-200">{task.model_type}</td>
                    <td className="text-slate-300">{task.dataset}</td>
                    <td><StatusBadge status={task.status} /></td>
                    <td className="mono text-xs text-slate-300">{formatDateTime(task.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <GpuMonitor />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: number;
  tone: "blue" | "amber" | "emerald" | "cyan";
  href: string;
}) {
  const tones = {
    blue: "border-t-blue-400 text-blue-300",
    amber: "border-t-amber-400 text-amber-300",
    emerald: "border-t-emerald-400 text-emerald-300",
    cyan: "border-t-cyan-400 text-cyan-300",
  }[tone];
  return (
    <Link
      href={href}
      className={`block rounded-lg border border-slate-800 border-t-2 bg-slate-900/95 px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.14)] transition-colors hover:border-slate-600 ${tones}`}
    >
      <div className="text-xs font-semibold">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-50">{value}</div>
    </Link>
  );
}
