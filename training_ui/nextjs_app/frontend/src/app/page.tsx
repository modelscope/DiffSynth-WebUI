"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/lib/basePath";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return (
    <div className="p-6 text-slate-400 text-sm">
      Redirecting to{" "}
      <a className="text-blue-300 underline" href={withBasePath("/dashboard")}>
        Dashboard
      </a>
      …
    </div>
  );
}
