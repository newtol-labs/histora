import fs from "node:fs";
import path from "node:path";
import { getAdapter, supportedAdapters } from "./adapters/index.mjs";
import { readConfig } from "./config.mjs";
import { applyDetectedSources, detectAgents } from "./discovery.mjs";
import { rebuildIndexes, writeSessionMarkdown } from "./markdown.mjs";
import {
  getSessionState,
  listProjects,
  listSessionStates,
  readLastRun,
  recordRun,
  statePaths,
  upsertSessionState
} from "./state.mjs";
import {
  displayPath,
  hashObject,
  isSyntheticMessageContent,
  redactText,
  stripControlChars
} from "./utils.mjs";

export async function runSync(options = {}) {
  const root = options.root || process.cwd();
  const config = options.config || applyDetectedSources(readConfig(root));
  const startedAt = new Date().toISOString();
  const summary = {
    startedAt,
    channels: [],
    totals: {
      discovered: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    }
  };

  for (const channel of config.channels) {
    if (options.channelId && channel.id !== options.channelId) continue;
    const channelSummary = await syncChannel(root, config, channel);
    summary.channels.push(channelSummary);
    for (const key of Object.keys(summary.totals)) {
      summary.totals[key] += Number(channelSummary[key] || 0);
    }
  }

  rebuildIndexes(root);
  const finishedAt = new Date().toISOString();
  const status = summary.totals.failed ? "partial" : "ok";
  const run = { startedAt, finishedAt, status, summary };
  recordRun(root, run);
  return run;
}

export async function syncChannel(root, config, channel) {
  const channelSummary = {
    id: channel.id,
    label: channel.label,
    enabled: channel.enabled,
    adapter: channel.adapter,
    source: displayPath(channel.source),
    discovered: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  if (!channel.enabled) {
    channelSummary.status = "disabled";
    return channelSummary;
  }

  const adapter = getAdapter(channel.adapter);
  if (!adapter) {
    channelSummary.status = "unsupported";
    channelSummary.errors.push(`Unsupported adapter: ${channel.adapter}`);
    return channelSummary;
  }

  if (!channel.source || !fs.existsSync(channel.source)) {
    channelSummary.status = "missing_source";
    channelSummary.errors.push(`Source not found: ${displayPath(channel.source)}`);
    return channelSummary;
  }

  try {
    const records = adapter.discover(channel);
    channelSummary.discovered = records.length;
    for (const rawRecord of records) {
      try {
        const record = normalizeRecord(rawRecord, config);
        const contentHash = hashObject({
          title: record.title,
          project: record.project,
          messages: record.messages
        });
        const previous = getSessionState(root, record.sourceKey);
        if (previous?.content_hash === contentHash) {
          channelSummary.skipped += 1;
          continue;
        }
        const syncedAt = new Date().toISOString();
        const { markdownPath, version } = writeSessionMarkdown(root, record, previous, contentHash, syncedAt);
        upsertSessionState(root, {
          ...record,
          markdownPath,
          contentHash,
          version,
          messageCount: record.messages.length,
          syncedAt
        });
        if (previous) channelSummary.updated += 1;
        else channelSummary.created += 1;
      } catch (error) {
        channelSummary.failed += 1;
        channelSummary.errors.push(error.message);
      }
    }
    channelSummary.status = channelSummary.failed ? "partial" : "ok";
  } catch (error) {
    channelSummary.status = "failed";
    channelSummary.failed += 1;
    channelSummary.errors.push(error.message);
  }

  return channelSummary;
}

export function normalizeRecord(record, config) {
  const redact = config.sync?.redact !== false;
  const messages = (record.messages || [])
    .map((message) => ({
      role: message.role,
      createdAt: message.createdAt || null,
      updatedAt: message.updatedAt || message.createdAt || null,
      content: stripControlChars(redact ? redactText(message.content) : message.content)
    }))
    .filter(
      (message) =>
        ["user", "assistant"].includes(message.role) &&
        message.content.trim() &&
        !isSyntheticMessageContent(message.content)
    );

  return {
    ...record,
    project: record.project || "default",
    title: record.title || "Untitled session",
    messages
  };
}

export function getStatus(root = process.cwd()) {
  const config = applyDetectedSources(readConfig(root));
  const state = statePaths(root);
  const sessions = listSessionStates(root, { limit: 1000 });
  const projects = listProjects(root);
  const lastRun = readLastRun(root);
  const detectedAgents = detectAgents(config);
  const detectedById = new Map(detectedAgents.map((agent) => [agent.id, agent]));
  const byChannel = new Map();
  for (const session of sessions) {
    const current = byChannel.get(session.channel_id) || { sessionCount: 0, lastUpdated: "" };
    current.sessionCount += 1;
    if (!current.lastUpdated || session.updated_at > current.lastUpdated) current.lastUpdated = session.updated_at;
    byChannel.set(session.channel_id, current);
  }

  return {
    root,
    state,
    supportedAdapters: supportedAdapters(),
    config: {
      sync: config.sync,
      channels: config.channels.map((channel) => ({
        ...channel,
        detectedAgent: detectedById.get(channel.id) || null,
        source: displayPath(channel.source),
        sourceExists: Boolean(channel.source && fs.existsSync(channel.source)),
        adapterSupported: Boolean(getAdapter(channel.adapter)),
        ...(byChannel.get(channel.id) || { sessionCount: 0, lastUpdated: "" })
      }))
    },
    detectedAgents,
    counts: {
      sessions: sessions.length,
      projects: projects.length
    },
    projects,
    recentSessions: sessions.slice(0, 100),
    lastRun
  };
}

export function readLogs(root = process.cwd()) {
  const logPath = path.join(statePaths(root).logs, "sync.log");
  if (!fs.existsSync(logPath)) return "";
  const text = fs.readFileSync(logPath, "utf8");
  return text.split(/\r?\n/).slice(-120).join("\n");
}
