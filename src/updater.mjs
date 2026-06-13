import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const RELEASES_URL = "https://github.com/newtol-labs/histora/releases/latest";

/**
 * Wraps electron-updater (autoUpdater) and exposes a small state machine that
 * the local HTTP API can read/drive, so the browser-based GUI can show update
 * progress and trigger install.
 *
 * macOS auto-install requires a code-signed app. When the app is unsigned we
 * gracefully degrade: we still detect new versions via the GitHub feed, but
 * instead of silently downloading we surface a "manual" state that points the
 * user at the Releases download page.
 */
export function createUpdater({ app, shell, isPackaged }) {
  const state = {
    supported: isPackaged,
    status: "idle", // idle | checking | available | downloading | downloaded | not-available | manual | error
    version: null,
    percent: 0,
    error: null
  };

  // In dev (not packaged) electron-updater refuses to run; report unsupported.
  if (!isPackaged) {
    return {
      getState: () => ({ ...state }),
      check: async () => ({ ...state }),
      install: () => {},
      openRelease: () => shell.openExternal(RELEASES_URL),
      autoCheck: () => {}
    };
  }

  const { autoUpdater } = require("electron-updater");

  // We control download timing so we can degrade to manual on unsigned macOS.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // On macOS, Squirrel.Mac requires a signed app to apply updates. Detect
  // whether this build is signed; if not, fall back to manual download.
  const macUnsigned =
    process.platform === "darwin" && !process.mas && !hasMacSignature(app);

  autoUpdater.on("checking-for-update", () => {
    state.status = "checking";
    state.error = null;
  });

  autoUpdater.on("update-available", (info) => {
    state.version = info?.version || null;
    if (macUnsigned) {
      // Cannot self-install — point the user to the download page.
      state.status = "manual";
      return;
    }
    state.status = "available";
    autoUpdater.downloadUpdate().catch((err) => {
      state.status = "error";
      state.error = err?.message || String(err);
    });
  });

  autoUpdater.on("update-not-available", () => {
    state.status = "not-available";
  });

  autoUpdater.on("download-progress", (progress) => {
    state.status = "downloading";
    state.percent = progress?.percent || 0;
  });

  autoUpdater.on("update-downloaded", (info) => {
    state.status = "downloaded";
    state.version = info?.version || state.version;
    state.percent = 100;
  });

  autoUpdater.on("error", (err) => {
    state.status = "error";
    state.error = err?.message || String(err);
  });

  async function check() {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      state.status = "error";
      state.error = err?.message || String(err);
    }
    return { ...state };
  }

  return {
    getState: () => ({ ...state }),
    check,
    install: () => {
      if (state.status === "downloaded") {
        autoUpdater.quitAndInstall();
      }
    },
    openRelease: () => shell.openExternal(RELEASES_URL),
    autoCheck: () => {
      // Silent check shortly after startup.
      setTimeout(() => {
        check();
      }, 3000);
    }
  };
}

function hasMacSignature(app) {
  // Best-effort: a signed, notarized app reports a non-empty code signature.
  // electron's app.isPackaged is already known; here we probe for a Team ID
  // via the app path. We keep this conservative — if we cannot prove it is
  // signed, treat as unsigned and use the manual fallback.
  try {
    // When built with a Developer ID, electron-builder embeds the signature;
    // there is no direct Electron API, so we rely on an env hint set at build.
    return process.env.HISTORA_MAC_SIGNED === "1";
  } catch {
    return false;
  }
}
