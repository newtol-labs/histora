import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readConfig, updateSyncConfig } from "./config.mjs";
import { installLaunchd } from "./launchd.mjs";
import { listSessionStates } from "./state.mjs";
import { getStatus, readLogs, runSync } from "./sync.mjs";

export function createChathubServer(options = {}) {
  const root = options.root || process.cwd();
  const publicDir = options.publicDir || path.join(root, "public");

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url, root);
        return;
      }
      serveStatic(res, url.pathname, publicDir);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });
}

export function startServer(options = {}) {
  const port = Number(options.port ?? process.env.HISTORA_PORT ?? process.env.CHATHUB_PORT ?? 4767);
  const host = options.host || process.env.HISTORA_HOST || process.env.CHATHUB_HOST || "127.0.0.1";
  const server = createChathubServer(options);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        port: actualPort,
        host,
        url: `http://${host}:${actualPort}`
      });
    });
  });
}

async function handleApi(req, res, url, root) {
  if (req.method === "GET" && url.pathname === "/api/status") {
    sendJson(res, 200, getStatus(root));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/sessions") {
    sendJson(res, 200, {
      sessions: listSessionStates(root, {
        channelId: url.searchParams.get("channel") || "",
        project: url.searchParams.get("project") || "",
        limit: Number(url.searchParams.get("limit") || 500)
      })
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    sendJson(res, 200, { logs: readLogs(root) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, readConfig(root));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sync-settings") {
    const body = await readBody(req);
    const config = updateSyncConfig(root, {
      cadence: body.cadence,
      interval_minutes: body.intervalMinutes,
      schedule: body.schedule
    });
    const launchd = installLaunchd(root);
    sendJson(res, 200, { config, launchd });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sync") {
    const body = await readBody(req);
    const run = await runSync({ root, channelId: body.channelId || "" });
    sendJson(res, 200, run);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/install-launchd") {
    sendJson(res, 200, installLaunchd(root));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/open") {
    const body = await readBody(req);
    const target = body.path || root;
    openPath(target);
    sendJson(res, 200, { ok: true, path: target });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function serveStatic(res, pathname, publicDir) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.normalize(path.join(publicDir, cleanPath));
  if (!fullPath.startsWith(publicDir) || !fs.existsSync(fullPath)) {
    sendText(res, 404, "Not found");
    return;
  }
  const ext = path.extname(fullPath);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon"
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(fullPath).pipe(res);
}

function openPath(target) {
  if (process.platform === "darwin") {
    execFile("open", [target], () => {});
    return;
  }
  if (process.platform === "win32") {
    execFile("cmd", ["/c", "start", "", target], () => {});
    return;
  }
  execFile("xdg-open", [target], () => {});
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value, null, 2));
}

function sendText(res, status, value) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(value);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  startServer()
    .then(({ url }) => {
      console.log(`Histora GUI: ${url}`);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
