import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { displayPath, expandHome } from "./utils.mjs";

export function detectAgents(config = {}) {
  const channels = new Map((config.channels || []).map((channel) => [channel.id, channel]));
  return agentDefinitions().map((definition) => detectAgent(definition, channels.get(definition.id)));
}

export function applyDetectedSources(config) {
  const detected = new Map(detectAgents(config).map((agent) => [agent.id, agent]));
  return {
    ...config,
    channels: (config.channels || []).map((channel) => {
      const agent = detected.get(channel.id);
      if (!agent) return channel;
      return {
        ...channel,
        adapter: channel.adapter || agent.adapter,
        source: channel.source || agent.rawSyncableSource || ""
      };
    })
  };
}

function detectAgent(definition, channel = {}) {
  const commandPath = firstCommand(definition.commands || []);
  const appPath = firstExisting(definition.apps || []);
  const configuredSource = channel.source || "";
  const sourceCandidates = [configuredSource, ...(definition.sources || [])].filter(Boolean).map(expandHome);
  const detectedSource = firstExisting(sourceCandidates);
  const syncableSource = isSyncablePath(detectedSource, definition) ? detectedSource : "";
  const installed = Boolean(commandPath || appPath || detectedSource);
  const sourcePath = configuredSource || detectedSource || definition.sources?.[0] || "";

  return {
    id: definition.id,
    label: definition.label,
    client: definition.client,
    adapter: channel.adapter || definition.adapter,
    installed,
    commandPath: displayPath(commandPath),
    appPath: displayPath(appPath),
    rawDetectedSource: detectedSource,
    rawSyncableSource: syncableSource,
    sourcePath: displayPath(sourcePath),
    detectedSource: displayPath(detectedSource),
    syncableSource: displayPath(syncableSource),
    sourceExists: Boolean(configuredSource && fs.existsSync(expandHome(configuredSource))),
    detectedSourceExists: Boolean(detectedSource),
    syncable: Boolean(syncableSource),
    note: noteFor(definition, installed, syncableSource)
  };
}

function agentDefinitions() {
  return [
    {
      id: "codex",
      label: "Codex",
      client: "CLI/Desktop",
      adapter: "codex-jsonl",
      commands: ["codex"],
      apps: macApps("Codex.app"),
      sources: ["~/.codex/sessions"]
    },
    {
      id: "claude-code",
      label: "Claude Code",
      client: "CLI",
      adapter: "claude-jsonl",
      commands: ["claude"],
      apps: macApps("Claude Code URL Handler.app"),
      sources: ["~/.claude/projects"]
    },
    {
      id: "opencode",
      label: "OpenCode",
      client: "CLI",
      adapter: "opencode-sqlite",
      commands: ["opencode"],
      sources: [defaultOpenCodePath()]
    },
    {
      id: "gemini-cli",
      label: "Gemini CLI",
      client: "CLI",
      adapter: "gemini-json",
      commands: ["gemini"],
      sources: ["~/.gemini/sessions", "~/.gemini/history.jsonl", "~/Downloads/gemini-export.json"],
      noteWhenInstalledWithoutSource:
        "已检测到 Gemini CLI；未找到默认会话导出路径 / Gemini CLI detected; no default session export found."
    },
    {
      id: "openclaw",
      label: "OpenClaw",
      client: "CLI",
      adapter: "openclaw-json",
      commands: ["openclaw"],
      sources: ["~/.openclaw/sessions", "~/.openclaw/history.jsonl", "~/Downloads/openclaw-export.json"]
    },
    {
      id: "hermes-agent",
      label: "Hermes Agent",
      client: "CLI/Desktop",
      adapter: "hermes-sqlite",
      commands: ["hermes"],
      apps: macApps("Hermes.app"),
      sources: ["~/.hermes/state.db"]
    }
  ];
}

function noteFor(definition, installed, syncableSource) {
  if (syncableSource) return "可同步 / Syncable";
  if (installed && definition.noteWhenInstalledWithoutSource) return definition.noteWhenInstalledWithoutSource;
  if (installed) return "已安装，但未找到可同步来源 / Installed, no syncable source found";
  return "未检测到安装 / Not detected";
}

function isSyncablePath(filePath, definition) {
  if (!filePath) return false;
  if (definition.id === "gemini-cli") return fs.statSync(filePath).isDirectory() || /\.(json|jsonl)$/i.test(filePath);
  return true;
}

function macApps(...names) {
  if (process.platform !== "darwin") return [];
  return names.flatMap((name) => [path.join("/Applications", name), path.join(os.homedir(), "Applications", name)]);
}

function defaultOpenCodePath() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "opencode", "opencode.db");
  }
  return "~/.local/share/opencode/opencode.db";
}

function firstExisting(candidates) {
  return candidates.map(expandHome).find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function firstCommand(commands) {
  for (const command of commands) {
    try {
      const tool = process.platform === "win32" ? "where" : "which";
      const output = execFileSync(tool, [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (output) return output;
    } catch {
      continue;
    }
  }
  return "";
}
