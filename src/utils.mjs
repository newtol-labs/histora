import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ROOT = process.cwd();

export function expandHome(input) {
  if (!input) return input;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function displayPath(input) {
  if (!input) return "";
  const home = os.homedir();
  return input.startsWith(home) ? `~${input.slice(home.length)}` : input;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function atomicWriteFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hashObject(value) {
  return sha256(stableStringify(value));
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function safeSlug(input, fallback = "untitled") {
  const text = String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return text || fallback;
}

export function shortId(input) {
  return safeSlug(String(input || "session")).slice(0, 18) || "session";
}

export function formatIso(input) {
  if (!input) return null;
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function formatLocal(input) {
  if (!input) return "";
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("sv-SE", { hour12: false });
}

export function datePart(input) {
  const iso = formatIso(input);
  return iso ? iso.slice(0, 10) : "undated";
}

export function projectNameFromPath(input) {
  if (!input) return "default";
  const normalized = input.replace(/\/+$/g, "");
  const base = path.basename(normalized);
  return base && base !== "/" ? base : "root";
}

export function stripControlChars(input) {
  return String(input || "").replace(/\u0000/g, "");
}

export function redactText(input) {
  let text = String(input || "");
  text = text.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_OPENAI_KEY]");
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, "Bearer [REDACTED_TOKEN]");
  text = text.replace(
    /\b(api[_-]?key|token|access[_-]?token|refresh[_-]?token|secret|password)\b\s*[:=]\s*["']?[^"'\s,;]{8,}/gi,
    "$1: [REDACTED]"
  );
  text = text.replace(
    /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]"
  );
  return text;
}

export function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const pieces = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.text === "string") pieces.push(item.text);
    else if (typeof item.content === "string") pieces.push(item.content);
  }
  return pieces.join("\n\n").trim();
}

export function titleFromMessages(messages, fallback = "Untitled session") {
  const firstUser = messages.find(
    (message) => message.role === "user" && message.content.trim() && !isSyntheticMessageContent(message.content)
  );
  const source = firstUser?.content || messages.find((message) => message.content.trim())?.content || fallback;
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 96) || fallback;
}

export function isSyntheticMessageContent(input) {
  const text = String(input || "").trim();
  return (
    text.startsWith("<environment_context>") ||
    text.startsWith("<developer_context>") ||
    text.startsWith("<user_editable_context>") ||
    text.startsWith("<local-command-caveat>") ||
    text.startsWith("Base directory for this skill:")
  );
}

export function walkFiles(root, predicate) {
  const files = [];
  if (!root || !fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (!predicate || predicate(fullPath)) files.push(fullPath);
    }
  }
  return files.sort();
}

export function parseJsonLines(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const rows = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      rows.push({ type: "parse_error", raw: line });
    }
  }
  return rows;
}

export function statSummary(filePath) {
  const stat = fs.statSync(filePath);
  return {
    sourceMtime: stat.mtime.toISOString(),
    sourceSize: stat.size
  };
}

export function parseMaybeEpoch(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
