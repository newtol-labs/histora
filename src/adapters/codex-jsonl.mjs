import path from "node:path";
import {
  extractTextContent,
  parseJsonLines,
  projectNameFromPath,
  statSummary,
  titleFromMessages,
  walkFiles
} from "../utils.mjs";

export const adapter = {
  id: "codex-jsonl",
  version: "codex-jsonl-v1",
  discover
};

function discover(channel) {
  const files = walkFiles(channel.source, (filePath) => filePath.endsWith(".jsonl"));
  return files.map((filePath) => parseCodexFile(channel, filePath)).filter(Boolean);
}

function parseCodexFile(channel, filePath) {
  const rows = parseJsonLines(filePath);
  const meta = rows.find((row) => row.type === "session_meta")?.payload || {};
  const messages = [];
  let createdAt = meta.timestamp || null;
  let updatedAt = meta.timestamp || null;

  for (const row of rows) {
    const timestamp = row.timestamp || row.payload?.timestamp || null;
    if (timestamp && (!createdAt || timestamp < createdAt)) createdAt = timestamp;
    if (timestamp && (!updatedAt || timestamp > updatedAt)) updatedAt = timestamp;

    if (row.type !== "response_item") continue;
    const payload = row.payload || {};
    if (payload.type !== "message") continue;
    if (!["user", "assistant"].includes(payload.role)) continue;
    const content = extractTextContent(payload.content);
    if (!content.trim()) continue;
    messages.push({
      role: payload.role,
      createdAt: timestamp,
      updatedAt: timestamp,
      content
    });
  }

  const stat = statSummary(filePath);
  const sessionId = meta.id || path.basename(filePath, ".jsonl");
  const cwd = meta.cwd || rows.find((row) => row.type === "turn_context")?.payload?.cwd || "";
  const project = projectNameFromPath(cwd);

  return {
    channelId: channel.id,
    channelLabel: channel.label,
    client: channel.client,
    adapterVersion: adapter.version,
    sourceType: "jsonl",
    sourcePath: filePath,
    sourceKey: `${channel.id}:${sessionId}`,
    sourceMtime: stat.sourceMtime,
    sourceSize: stat.sourceSize,
    sessionId,
    project,
    title: titleFromMessages(messages, path.basename(filePath, ".jsonl")),
    createdAt: createdAt || stat.sourceMtime,
    updatedAt: updatedAt || stat.sourceMtime,
    sourceAppVersion: meta.cli_version || "unknown",
    messages
  };
}
