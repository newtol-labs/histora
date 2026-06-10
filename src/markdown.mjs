import fs from "node:fs";
import path from "node:path";
import {
  atomicWriteFile,
  datePart,
  displayPath,
  ensureDir,
  formatLocal,
  safeSlug,
  sha256,
  shortId
} from "./utils.mjs";
import { listProjects, listSessionStates } from "./state.mjs";

export function markdownPathFor(root, record, previousState) {
  if (previousState?.markdown_path) return previousState.markdown_path;
  const channelSlug = safeSlug(record.channelId || record.channelLabel, "channel");
  const projectSlug = projectSlugFor(record.project);
  const titleSlug = safeSlug(record.title, "session");
  const fileName = `${datePart(record.createdAt || record.updatedAt)}__${titleSlug}__${shortId(record.sessionId)}.md`;
  return path.join(root, "channels", channelSlug, "projects", projectSlug, "sessions", fileName);
}

export function renderSessionMarkdown(record, version, contentHash, syncedAt) {
  const frontmatter = {
    histora_schema: 1,
    channel: record.channelLabel,
    client: record.client,
    project: record.project,
    session_id: record.sessionId,
    title: record.title,
    source_type: record.sourceType,
    source_path: displayPath(record.sourcePath),
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    synced_at: syncedAt,
    version,
    source_app_version: record.sourceAppVersion || "unknown",
    adapter_version: record.adapterVersion,
    message_count: record.messages.length,
    content_hash: `sha256:${contentHash}`
  };

  const body = [
    `# ${escapeHeading(record.title)}`,
    "",
    `Channel: ${record.channelLabel}`,
    `Project: ${record.project}`,
    `Session: ${record.sessionId}`,
    "",
    "## Conversation",
    "",
    ...record.messages.flatMap((message) => renderMessage(message))
  ].join("\n");

  return `---\n${renderYaml(frontmatter)}---\n\n${body.trim()}\n`;
}

export function writeSessionMarkdown(root, record, previousState, contentHash, syncedAt) {
  const version = previousState ? Number(previousState.version || 0) + 1 : 1;
  const markdownPath = markdownPathFor(root, record, previousState);
  const markdown = renderSessionMarkdown(record, version, contentHash, syncedAt);
  atomicWriteFile(markdownPath, markdown);
  return { markdownPath, version };
}

export function rebuildIndexes(root) {
  ensureDir(path.join(root, "channels"));
  const projects = listProjects(root);
  const lines = [
    "# Histora Index",
    "",
    "| Channel | Project | Sessions | Last Updated |",
    "| --- | --- | ---: | --- |"
  ];
  for (const project of projects) {
    const projectPath = projectIndexPath(root, project.channel_id, project.project);
    const rel = path.relative(root, projectPath);
    lines.push(
      `| ${escapeTable(project.channel_label)} | [${escapeTable(project.project)}](${encodeLink(rel)}) | ${project.session_count} | ${project.updated_at || ""} |`
    );
    rebuildProjectIndex(root, project.channel_id, project.project);
  }
  atomicWriteFile(path.join(root, "_index.md"), `${lines.join("\n")}\n`);
}

function rebuildProjectIndex(root, channelId, project) {
  const sessions = listSessionStates(root, { channelId, project, limit: 2000 });
  const lines = [
    `# ${project}`,
    "",
    `Channel: ${sessions[0]?.channel_label || channelId}`,
    "",
    "| Updated | Version | Title | Messages |",
    "| --- | ---: | --- | ---: |"
  ];
  const indexPath = projectIndexPath(root, channelId, project);
  for (const session of sessions) {
    const rel = path.relative(path.dirname(indexPath), session.markdown_path);
    lines.push(
      `| ${session.updated_at || ""} | ${session.version} | [${escapeTable(session.title || session.session_id)}](${encodeLink(rel)}) | ${session.message_count} |`
    );
  }
  atomicWriteFile(indexPath, `${lines.join("\n")}\n`);
}

function projectIndexPath(root, channelId, project) {
  return path.join(root, "channels", safeSlug(channelId), "projects", projectSlugFor(project), "_index.md");
}

function renderMessage(message) {
  const role = titleCase(message.role || "message");
  const time = formatLocal(message.createdAt || message.updatedAt);
  const header = time ? `### ${role} - ${time}` : `### ${role}`;
  return [header, "", message.content.trim() || "_No text content._", ""];
}

function renderYaml(values) {
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${yamlValue(value)}`)
    .join("\n") + "\n";
}

function yamlValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (!text || /[:#\n\r]|^\s|\s$/.test(text)) return JSON.stringify(text);
  return text;
}

function titleCase(value) {
  return String(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHeading(value) {
  return String(value || "Untitled session")
    .replace(/\r?\n/g, " ")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();
}

function escapeTable(value) {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, " ");
}

function encodeLink(value) {
  return value.split(path.sep).map(encodeURIComponent).join("/");
}

function projectSlugFor(project) {
  const slug = safeSlug(project, "project");
  const hash = sha256(String(project || "project")).slice(0, 8);
  return `${slug}-${hash}`;
}
