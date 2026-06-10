import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseMaybeEpoch,
  projectNameFromPath,
  statSummary,
  titleFromMessages
} from "../utils.mjs";
import { sqlString } from "../state.mjs";

export const adapter = {
  id: "opencode-sqlite",
  version: "opencode-sqlite-v1",
  discover
};

function discover(channel) {
  if (!fs.existsSync(channel.source)) return [];
  const sessions = sqliteJson(
    channel.source,
    `select s.id, s.title, s.version, s.directory, s.time_created, s.time_updated,
            s.agent, s.model, p.name as project_name, p.worktree
     from session s
     left join project p on p.id = s.project_id
     order by s.time_updated asc;`
  );
  const stat = statSummary(channel.source);
  return sessions.map((session) => parseOpenCodeSession(channel, session, stat));
}

function parseOpenCodeSession(channel, session, stat) {
  const messages = sqliteJson(
    channel.source,
    `select id, json_extract(data, '$.role') as role, time_created, time_updated
     from message
     where session_id = ${sqlString(session.id)}
     order by time_created asc, id asc;`
  );
  const parts = sqliteJson(
    channel.source,
    `select message_id, json_extract(data, '$.type') as type,
            json_extract(data, '$.text') as text, time_created, id
     from part
     where session_id = ${sqlString(session.id)}
     order by time_created asc, id asc;`
  );
  const partsByMessage = new Map();
  for (const part of parts) {
    if (part.type !== "text" || !part.text) continue;
    const list = partsByMessage.get(part.message_id) || [];
    list.push(part.text);
    partsByMessage.set(part.message_id, list);
  }
  const renderedMessages = messages
    .filter((message) => ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      createdAt: parseMaybeEpoch(message.time_created),
      updatedAt: parseMaybeEpoch(message.time_updated),
      content: (partsByMessage.get(message.id) || []).join("\n\n").trim()
    }))
    .filter((message) => message.content);

  const projectSource = session.project_name || session.worktree || session.directory || "";
  const project = projectNameFromPath(projectSource);

  return {
    channelId: channel.id,
    channelLabel: channel.label,
    client: channel.client,
    adapterVersion: adapter.version,
    sourceType: "sqlite",
    sourcePath: channel.source,
    sourceKey: `${channel.id}:${session.id}`,
    sourceMtime: stat.sourceMtime,
    sourceSize: stat.sourceSize,
    sessionId: session.id,
    project,
    title: session.title || titleFromMessages(renderedMessages, path.basename(session.directory || "session")),
    createdAt: parseMaybeEpoch(session.time_created) || stat.sourceMtime,
    updatedAt: parseMaybeEpoch(session.time_updated) || stat.sourceMtime,
    sourceAppVersion: session.version || "unknown",
    messages: renderedMessages
  };
}

function sqliteJson(dbPath, sql) {
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : [];
}
