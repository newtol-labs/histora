import fs from "node:fs";
import path from "node:path";
import {
  extractTextContent,
  hashObject,
  parseJsonLines,
  parseMaybeEpoch,
  projectNameFromPath,
  statSummary,
  titleFromMessages,
  walkFiles
} from "../utils.mjs";

export function discoverJsonConversations(channel, options = {}) {
  const files = discoverFiles(channel.source);
  return files.flatMap((filePath) => parseConversationFile(channel, filePath, options));
}

function discoverFiles(source) {
  if (!source || !fs.existsSync(source)) return [];
  const stat = fs.statSync(source);
  if (stat.isFile()) return isConversationFile(source) ? [source] : [];
  return walkFiles(source, isConversationFile);
}

function isConversationFile(filePath) {
  return /\.(json|jsonl)$/i.test(filePath);
}

function parseConversationFile(channel, filePath, options) {
  const stat = statSummary(filePath);
  if (filePath.endsWith(".jsonl")) return parseJsonlConversationFile(channel, filePath, stat, options);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const conversations = extractConversations(data);
  return conversations.map((conversation, index) => parseConversation(channel, filePath, stat, conversation, index, options));
}

function parseJsonlConversationFile(channel, filePath, stat, options) {
  const rows = parseJsonLines(filePath).filter((row) => row && typeof row === "object");
  if (rows.some((row) => Array.isArray(row.messages) || row.mapping)) {
    return rows.map((row, index) => parseConversation(channel, filePath, stat, row, index, options));
  }
  const groups = new Map();
  for (const row of rows) {
    const sessionId = row.session_id || row.sessionId || row.conversation_id || row.conversationId || path.basename(filePath);
    const group = groups.get(sessionId) || { id: sessionId, messages: [] };
    group.messages.push(row);
    groups.set(sessionId, group);
  }
  return [...groups.values()].map((conversation, index) =>
    parseConversation(channel, filePath, stat, conversation, index, options)
  );
}

function extractConversations(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const key of ["conversations", "sessions", "chats", "data", "items"]) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [data];
}

function parseConversation(channel, filePath, stat, conversation, index, options) {
  const messages = extractMessages(conversation);
  const createdAt =
    parseMaybeEpoch(firstValue(conversation, ["created_at", "createdAt", "create_time", "started_at", "timestamp"])) ||
    messages[0]?.createdAt ||
    stat.sourceMtime;
  const lastMessage = [...messages].reverse().find((message) => message.updatedAt || message.createdAt);
  const updatedAt =
    parseMaybeEpoch(firstValue(conversation, ["updated_at", "updatedAt", "update_time", "ended_at"])) ||
    lastMessage?.updatedAt ||
    lastMessage?.createdAt ||
    createdAt;
  const sessionId =
    firstValue(conversation, ["id", "uuid", "session_id", "sessionId", "conversation_id", "conversationId"]) ||
    hashObject({ filePath, index, title: conversation.title, createdAt }).slice(0, 24);
  const projectSource =
    firstValue(conversation, ["project", "project_name", "projectName", "workspace", "cwd", "directory"]) ||
    options.defaultProject ||
    projectNameFromPath(path.dirname(filePath));

  return {
    channelId: channel.id,
    channelLabel: channel.label,
    client: channel.client,
    adapterVersion: options.adapterVersion || "conversation-json-v1",
    sourceType: path.extname(filePath).slice(1) || "json",
    sourcePath: filePath,
    sourceKey: `${channel.id}:${sessionId}`,
    sourceMtime: stat.sourceMtime,
    sourceSize: stat.sourceSize,
    sessionId,
    project: projectNameFromPath(String(projectSource)),
    title: conversation.title || conversation.name || titleFromMessages(messages, `${options.label || "Conversation"} session`),
    createdAt,
    updatedAt,
    sourceAppVersion: conversation.version || conversation.model || options.sourceAppVersion || "export",
    messages
  };
}

function extractMessages(conversation) {
  if (conversation.mapping && typeof conversation.mapping === "object") {
    return Object.values(conversation.mapping)
      .filter((node) => node?.message)
      .sort((a, b) => Number(a.message?.create_time || 0) - Number(b.message?.create_time || 0))
      .map((node) => messageFromObject(node.message))
      .filter((message) => message.role && message.content);
  }
  const rawMessages =
    conversation.messages ||
    conversation.chat_messages ||
    conversation.chatMessages ||
    conversation.turns ||
    conversation.entries ||
    [];
  return (Array.isArray(rawMessages) ? rawMessages : [])
    .map(messageFromObject)
    .filter((message) => ["user", "assistant"].includes(message.role) && message.content);
}

function messageFromObject(raw) {
  const role = normalizeRole(raw.role || raw.type || raw.sender || raw.author?.role || raw.message?.role);
  const createdAt = parseMaybeEpoch(
    firstValue(raw, ["created_at", "createdAt", "create_time", "timestamp", "time", "date"])
  );
  const updatedAt = parseMaybeEpoch(firstValue(raw, ["updated_at", "updatedAt", "update_time"])) || createdAt;
  return {
    role,
    createdAt,
    updatedAt,
    content: extractContent(raw)
  };
}

function normalizeRole(role) {
  const value = String(role || "").toLowerCase();
  if (["human", "customer", "prompt"].includes(value)) return "user";
  if (["ai", "bot", "model", "completion"].includes(value)) return "assistant";
  return value;
}

function extractContent(raw) {
  const content = raw.content ?? raw.text ?? raw.message?.content ?? raw.message ?? raw.body;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return extractTextContent(content);
  if (content?.parts && Array.isArray(content.parts)) return content.parts.map(partToText).filter(Boolean).join("\n\n").trim();
  if (typeof content?.text === "string") return content.text.trim();
  return "";
}

function partToText(part) {
  if (typeof part === "string") return part;
  if (part && typeof part === "object") return part.text || part.content || "";
  return "";
}

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}
