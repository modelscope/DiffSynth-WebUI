"use strict";
const http = require("http");

const BASE_PATH = (process.env.BASE_PATH || "").replace(/\/+$/, "");
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 8100);
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || 8101);
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "127.0.0.1";
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 8000);
const BACKEND_HOST = process.env.BACKEND_HOST || "127.0.0.1";
const QUIET = process.env.QUIET === "1";

if (!BASE_PATH) {
  console.error("[dsw-adapter] 未设置 BASE_PATH。");
  process.exit(1);
}

function dashboardLocation() {
  return BASE_PATH + "/dashboard";
}

function routeRequest(originalUrl) {
  if (originalUrl === BASE_PATH || originalUrl.startsWith(BASE_PATH + "/") ||
      originalUrl.startsWith(BASE_PATH + "?")) {
    if (originalUrl === BASE_PATH || originalUrl === BASE_PATH + "/" || originalUrl.startsWith(BASE_PATH + "?")) {
      return { redirect: dashboardLocation() };
    }
    return { targetPath: originalUrl };
  }
  if (originalUrl === "/" || originalUrl === "") {
    return { redirect: dashboardLocation() };
  }
  return { targetPath: BASE_PATH + (originalUrl.startsWith("/") ? originalUrl : "/" + originalUrl) };
}

const server = http.createServer((req, res) => {
  const routed = routeRequest(req.url || "/");
  if (routed.redirect) {
    res.writeHead(302, { Location: routed.redirect });
    res.end();
    return;
  }
  const apiPrefix = BASE_PATH + "/api/";
  const isApi = routed.targetPath.startsWith(apiPrefix);
  const targetPath = isApi ? routed.targetPath.slice(BASE_PATH.length) : routed.targetPath;
  const targetHost = isApi ? BACKEND_HOST : UPSTREAM_HOST;
  const targetPort = isApi ? BACKEND_PORT : UPSTREAM_PORT;
  const options = {
    hostname: targetHost,
    port: targetPort,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `${targetHost}:${targetPort}` },
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (err) => {
    console.error("[dsw-adapter] upstream error:", err.message, "path:", targetPath);
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`upstream error: ${err.message}`);
  });
  req.pipe(proxyReq);
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  if (!QUIET) {
    console.log(`[dsw-adapter] listening 0.0.0.0:${LISTEN_PORT}`);
    console.log(`[dsw-adapter] BASE_PATH="${BASE_PATH}"`);
    console.log(`[dsw-adapter] upstream = http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
    console.log(`[dsw-adapter] backend = http://${BACKEND_HOST}:${BACKEND_PORT}`);
  }
});
