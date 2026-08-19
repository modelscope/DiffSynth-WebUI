const fs = require("fs");
const path = require("path");

const NEXT_DIR = path.resolve(__dirname, "..", ".next");
const SNAPSHOT = path.join(NEXT_DIR, "DIFFSYNTH_BASE_PATH");

const current = (process.env.NEXT_BASE_PATH || "").replace(/\/+$/, "");
const currentDisplay = current || "(root)";

if (!fs.existsSync(NEXT_DIR)) {
  console.error("[check-build] .next 目录不存在，请先执行 `npm run build`。");
  process.exit(1);
}

if (!fs.existsSync(SNAPSHOT)) {
  console.error("[check-build] 缺少 basePath 快照，请重新执行 `npm run build`。");
  process.exit(1);
}
const built = fs.readFileSync(SNAPSHOT, "utf8").trim();
const builtDisplay = built || "(root)";

if (built !== current) {
  console.error("");
  console.error(`[check-build] NEXT_BASE_PATH mismatch: build="${builtDisplay}", current="${currentDisplay}"`);
  console.error("[check-build] Rebuild with the same NEXT_BASE_PATH before starting.");
  console.error("");
  process.exit(2);
}

console.log(`[check-build] OK, basePath="${currentDisplay}"`);
