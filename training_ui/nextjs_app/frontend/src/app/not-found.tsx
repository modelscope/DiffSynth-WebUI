"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BASE_PATH, withBasePath } from "@/lib/basePath";

export default function NotFound() {
  useEffect(() => {
    const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
    const enteredThroughWrongDswPort =
      !!BASE_PATH && pathname.includes("/ide/proxy/") && !pathname.startsWith(BASE_PATH);
    if (pathname === "/" || enteredThroughWrongDswPort) {
      window.location.replace(withBasePath("/dashboard"));
    }
  }, []);

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="rounded-xl border border-slate-800 bg-gradient-to-b from-slate-900/60 to-slate-950/60 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <span className="text-amber-300 text-lg font-semibold">!</span>
          </div>
          <div>
            <div className="text-lg font-semibold text-slate-100">404 · Page Not Found</div>
            <div className="text-xs text-slate-400 mt-0.5">
              The link may be outdated or incorrect
            </div>
          </div>
        </div>

        <div className="mt-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 text-sm"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
