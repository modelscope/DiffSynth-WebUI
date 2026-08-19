import type { NextConfig } from "next";
import path from "path";

const backend = process.env.DIFFSYNTH_UI_BACKEND || "http://127.0.0.1:8000";

const rawBase = (process.env.NEXT_BASE_PATH || "").trim();
const basePath = rawBase.replace(/\/+$/, "");

const staticExport = process.env.STATIC_EXPORT === "1";
const configuredUploadLimit = Number.parseInt(
  process.env.DIFFSYNTH_UI_UPLOAD_LIMIT_BYTES || "",
  10,
);
const uploadBodySize =
  Number.isFinite(configuredUploadLimit) && configuredUploadLimit > 0
    ? configuredUploadLimit
    : 256 * 1024 * 1024;

const nextConfig: NextConfig = {
  reactStrictMode: true,

  experimental: {
    middlewareClientMaxBodySize: uploadBodySize,
  },

  outputFileTracingRoot: path.resolve(__dirname),

  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },

  ...(staticExport ? { output: "export" as const, trailingSlash: true } : {}),

  async rewrites() {
    if (staticExport) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
