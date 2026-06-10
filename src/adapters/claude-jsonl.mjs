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
  id: "claude-jsonl",
  version: "claude-jsonl-v1",
  discover
};

function discover(channel) {
  const files = walkFiles(channel.source, (filePath) => filePath.endsWith(".jsonl"));
  return files.map((filePath) => parseClaudeFile(channel, filePath)).filter(Boolean);
}

function parseClaudeFile(channel, filePath) {
  const rows = parseJsonLines(filePath);
  const messages = [];
  let createdAt = null;
  let updatedAt = null;
  let cwd = "";
  let sessionId = path.basename(filePath, ".jsonl");
  let sourceAppVersion = "unknown";

  for (const row of rows) {
    const timestamp = row.timestamp || null;
    if (timestamp && (!createdAt || timestamp < createdAt)) createdAt = timestamp;
    if (timestamp && (!updatedAt || timestamp > updatedAt)) updatedAt = timestamp;
    if (row.cwd) cwd = row.cwd;
    if (row.sessionId) sessionId = row.sessionId;
    if (row.version) sourceAppVersion = row.version;

    if (!["user", "assistant"].includes(row.type)) continue;
    const role = row.message?.role || row.type;
    if (!["user", "assistant"].includes(role)) continue;
    const content = extractTextContent(row.message?.content);
    if (!content.trim()) continue;
    messages.push({
      role,
      createdAt: timestamp,
      updatedAt: timestamp,
      content
    });
  }

  const stat = statSummary(filePath);
  const project = projectNameFromPath(cwd || decodeClaudeProjectFolder(channel.source, filePath));

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
    sourceAppVersion,
    messages
  };
}

function decodeClaudeProjectFolder(root, filePath) {
  const rel = path.relative(root, path.dirname(filePath)).split(path.sep)[0] || "default";
  return rel.replace(/^-/, "/").replace(/-/g, "/");
}
