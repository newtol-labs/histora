import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile, displayPath, expandHome, ROOT } from "./utils.mjs";

export const CONFIG_FILE = "histora.config.yaml";
export const LEGACY_CONFIG_FILE = "chathub.config.yaml";

export function readConfig(root = ROOT) {
  const configPath = configPathFor(root);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing ${CONFIG_FILE}`);
  }
  const config = parseConfig(fs.readFileSync(configPath, "utf8"));
  config.workspace = expandHome(config.workspace || root);
  config.sync = {
    schedule: "23:00",
    cadence: "daily",
    interval_minutes: 0,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    redact: true,
    ...(config.sync || {})
  };
  config.sync.interval_minutes = Number(config.sync.interval_minutes || 0);
  config.channels = (config.channels || []).map((channel) => ({
    ...channel,
    source: expandHome(channel.source || ""),
    enabled: Boolean(channel.enabled)
  }));
  return config;
}

export function updateSyncConfig(root = ROOT, patch = {}) {
  const config = readConfig(root);
  const cadence = normalizeCadence(patch.cadence ?? config.sync.cadence);
  const intervalMinutes = normalizeIntervalMinutes(patch.interval_minutes ?? patch.intervalMinutes ?? config.sync.interval_minutes);
  const schedule = normalizeSchedule(patch.schedule ?? config.sync.schedule);

  config.sync = {
    ...config.sync,
    cadence,
    interval_minutes: cadence === "interval" ? intervalMinutes : 0,
    schedule
  };

  const configPath = configPathFor(root);
  atomicWriteFile(configPath, renderConfig(config));
  return readConfig(root);
}

export function configPathFor(root = ROOT) {
  const current = path.join(root, CONFIG_FILE);
  if (fs.existsSync(current)) return current;
  const legacy = path.join(root, LEGACY_CONFIG_FILE);
  if (fs.existsSync(legacy)) return legacy;
  return current;
}

export function renderConfig(config) {
  const lines = [
    `workspace: ${yamlScalar(config.workspace)}`,
    "",
    "sync:",
    `  schedule: ${yamlScalar(config.sync.schedule || "23:00")}`,
    `  cadence: ${yamlScalar(config.sync.cadence || "daily")}`,
    `  interval_minutes: ${Number(config.sync.interval_minutes || 0)}`,
    `  timezone: ${yamlScalar(config.sync.timezone || "UTC")}`,
    `  redact: ${config.sync.redact !== false ? "true" : "false"}`,
    "",
    "channels:"
  ];

  for (const channel of config.channels || []) {
    lines.push(
      `  - id: ${yamlScalar(channel.id)}`,
      `    label: ${yamlScalar(channel.label)}`,
      `    client: ${yamlScalar(channel.client)}`,
      `    adapter: ${yamlScalar(channel.adapter)}`,
      `    source: ${yamlScalar(displayPath(channel.source || ""))}`,
      `    enabled: ${channel.enabled ? "true" : "false"}`
    );
  }

  return `${lines.join("\n")}\n`;
}

export function parseConfig(text) {
  const config = {};
  let section = null;
  let currentChannel = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/g, "");
    if (!withoutComment.trim()) continue;

    const top = withoutComment.match(/^([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
    if (top) {
      const [, key, value] = top;
      if (key === "sync") {
        config.sync = {};
        section = "sync";
      } else if (key === "channels") {
        config.channels = [];
        section = "channels";
      } else {
        config[key] = parseScalar(value ?? "");
        section = null;
      }
      continue;
    }

    const nested = withoutComment.match(/^  ([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
    if (nested && section === "sync") {
      config.sync[nested[1]] = parseScalar(nested[2] ?? "");
      continue;
    }

    const channelStart = withoutComment.match(/^  - ([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
    if (channelStart && section === "channels") {
      currentChannel = {};
      currentChannel[channelStart[1]] = parseScalar(channelStart[2] ?? "");
      config.channels.push(currentChannel);
      continue;
    }

    const channelField = withoutComment.match(/^    ([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
    if (channelField && section === "channels" && currentChannel) {
      currentChannel[channelField[1]] = parseScalar(channelField[2] ?? "");
    }
  }

  return config;
}

function parseScalar(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function yamlScalar(value) {
  const text = String(value ?? "");
  if (!text) return '""';
  if (/^[A-Za-z0-9_./~-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function normalizeCadence(value) {
  return value === "interval" ? "interval" : "daily";
}

function normalizeIntervalMinutes(value) {
  const minutes = Math.round(Number(value || 0));
  if (!Number.isFinite(minutes) || minutes < 1) return 60;
  return Math.min(minutes, 1439);
}

function normalizeSchedule(value) {
  const text = String(value || "23:00");
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "23:00";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "23:00";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
