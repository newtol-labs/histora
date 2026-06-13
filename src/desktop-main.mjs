import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Menu, shell } from "electron";
import { CONFIG_FILE, LEGACY_CONFIG_FILE, renderConfig } from "./config.mjs";
import { runSync } from "./sync.mjs";
import { ensureDir } from "./utils.mjs";
import { startServer } from "./server.mjs";
import { createUpdater } from "./updater.mjs";

const isSyncOnly = process.argv.includes("--histora-sync") || process.argv.includes("--chathub-sync");

if (!app.requestSingleInstanceLock() && !isSyncOnly) {
  app.quit();
}

app.setName("Histora");

if (isSyncOnly) {
  runSyncOnly();
} else {
  let mainWindow = null;
  let serverHandle = null;
  let updater = null;

  const openMainWindow = () => {
    if (!serverHandle) return null;
    mainWindow = createWindow(serverHandle.url);
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
    return mainWindow;
  };

  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      openMainWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const workspaceRoot = resolveWorkspaceRoot();
    ensureDesktopWorkspace(workspaceRoot);
    updater = createUpdater({ app, shell, isPackaged: app.isPackaged });
    serverHandle = await startServer({
      root: workspaceRoot,
      publicDir: path.join(app.getAppPath(), "public"),
      port: 0,
      updater
    });

    openMainWindow();
    setApplicationMenu(mainWindow, workspaceRoot, updater);
    updater.autoCheck();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    serverHandle?.server?.close();
  });
}

async function runSyncOnly() {
  let exitCode = 0;
  const timer = setTimeout(() => {
    console.error("[Histora sync] timed out after 10 minutes");
    app.exit(124);
    process.exit(124);
  }, 10 * 60 * 1000);
  timer.unref?.();

  try {
    const workspaceRoot = resolveWorkspaceRoot();
    console.log(`[Histora sync] start ${new Date().toISOString()} root=${workspaceRoot}`);
    ensureDesktopWorkspace(workspaceRoot);
    const run = await runSync({ root: workspaceRoot });
    console.log(JSON.stringify(run.summary, null, 2));
    console.log(`[Histora sync] finish ${run.finishedAt} status=${run.status}`);
  } catch (error) {
    exitCode = 1;
    console.error(error.stack || error.message);
  } finally {
    clearTimeout(timer);
    app.exit(exitCode);
    process.exit(exitCode);
  }
}

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 660,
    title: "Histora",
    backgroundColor: "#f7f8fa",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.loadURL(url);
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  return window;
}

function setApplicationMenu(window, workspaceRoot, updater) {
  const template = [
    {
      label: "Histora",
      submenu: [
        {
          label: "Open Histora Folder / 打开 Histora 文件夹",
          click: () => shell.openPath(workspaceRoot)
        },
        {
          label: "Reload / 重新载入",
          accelerator: "CmdOrCtrl+R",
          click: () => window.reload()
        },
        {
          label: "Check for Updates / 检查更新",
          click: () => updater?.check()
        },
        { type: "separator" },
        {
          label: "Quit / 退出",
          accelerator: "CmdOrCtrl+Q",
          click: () => app.quit()
        }
      ]
    },
    {
      label: "View / 视图",
      submenu: [
        { role: "toggleDevTools", label: "Developer Tools / 开发者工具" },
        { role: "resetZoom", label: "Actual Size / 实际大小" },
        { role: "zoomIn", label: "Zoom In / 放大" },
        { role: "zoomOut", label: "Zoom Out / 缩小" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function resolveWorkspaceRoot() {
  if (process.env.HISTORA_WORKSPACE) return path.resolve(process.env.HISTORA_WORKSPACE);
  if (process.env.CHATHUB_WORKSPACE) return path.resolve(process.env.CHATHUB_WORKSPACE);
  if (app.isPackaged) return resolvePackagedWorkspaceRoot();
  return process.cwd();
}

function resolvePackagedWorkspaceRoot() {
  const documents = app.getPath("documents");
  const candidates = [
    path.join(documents, "Chathub"),
    path.join(documents, "Histora")
  ];
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, CONFIG_FILE)) ||
      fs.existsSync(path.join(candidate, LEGACY_CONFIG_FILE))
    ) {
      return candidate;
    }
  }
  return candidates[0];
}

function ensureDesktopWorkspace(workspaceRoot) {
  ensureDir(workspaceRoot);
  const configPath = path.join(workspaceRoot, CONFIG_FILE);
  const legacyConfigPath = path.join(workspaceRoot, LEGACY_CONFIG_FILE);
  if (fs.existsSync(configPath) || fs.existsSync(legacyConfigPath)) return;
  fs.writeFileSync(configPath, renderConfig(defaultConfig(workspaceRoot)), "utf8");
}

function defaultConfig(workspaceRoot) {
  return {
    workspace: workspaceRoot,
    sync: {
      schedule: "23:00",
      cadence: "daily",
      interval_minutes: 0,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      redact: true
    },
    channels: [
      {
        id: "codex",
        label: "Codex",
        client: "CLI/Desktop",
        adapter: "codex-jsonl",
        source: "~/.codex/sessions",
        enabled: true
      },
      {
        id: "claude-code",
        label: "Claude Code",
        client: "CLI",
        adapter: "claude-jsonl",
        source: "~/.claude/projects",
        enabled: true
      },
      {
        id: "opencode",
        label: "OpenCode",
        client: "CLI",
        adapter: "opencode-sqlite",
        source: defaultOpenCodePath(),
        enabled: true
      },
      {
        id: "gemini-cli",
        label: "Gemini CLI",
        client: "CLI",
        adapter: "gemini-json",
        source: defaultGeminiCliPath(),
        enabled: true
      },
      {
        id: "openclaw",
        label: "OpenClaw",
        client: "CLI",
        adapter: "openclaw-json",
        source: defaultOpenClawPath(),
        enabled: true
      },
      {
        id: "hermes-agent",
        label: "Hermes Agent",
        client: "CLI/Desktop",
        adapter: "hermes-sqlite",
        source: defaultHermesPath(),
        enabled: true
      }
    ]
  };
}

function defaultOpenCodePath() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "opencode", "opencode.db");
  }
  return "~/.local/share/opencode/opencode.db";
}

function defaultGeminiCliPath() {
  return "~/.gemini/sessions";
}

function defaultOpenClawPath() {
  return "~/.openclaw/sessions";
}

function defaultHermesPath() {
  return "~/.hermes/state.db";
}
