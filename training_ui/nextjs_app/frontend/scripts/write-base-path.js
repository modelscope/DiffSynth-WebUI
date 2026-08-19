const fs = require("fs");
const path = require("path");

const NEXT_DIR = path.resolve(__dirname, "..", ".next");
const SNAPSHOT = path.join(NEXT_DIR, "DIFFSYNTH_BASE_PATH");

const base = (process.env.NEXT_BASE_PATH || "").replace(/\/+$/, "");

if (!fs.existsSync(NEXT_DIR)) {
  console.error("[write-base-path] .next 目录不存在，请先执行 `next build`。");
  process.exit(1);
}
fs.writeFileSync(SNAPSHOT, base, "utf8");
console.log(`[write-base-path] snapshot NEXT_BASE_PATH="${base || "(root)"}"`);
