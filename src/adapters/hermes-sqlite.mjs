import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseMaybeEpoch, projectNameFromPath, statSummary, titleFromMessages } from "../utils.mjs";
import { sqlString } from "../state.mjs";

export const adapter = {
  id: "hermes-sqlite",
  version: "hermes-sqlite-v1",
  discover
};

function discover(channel) {
  if (!fs.existsSync(channel.source)) return [];
  const sessions = sqliteJson(
    channel.source,
    `select id, source, model, title, cwd, started_at, ended_at, end_reason, message_count
     from sessions
     order by started_at asc;`
  );
  const stat = statSummary(channel.source);
  return sessions.map((session) => parseHermesSession(channel, session, stat));
}

function parseHermesSession(channel, session, stat) {
  const messages = sqliteJson(
    channel.source,
    `select role, content, timestamp
     from messages
     where session_id = ${sqlString(session.id)}
       and active = 1
       and role in ('user', 'assistant')
     order by timestamp asc, id asc;`
  )
    .map((message) => ({
      role: message.role,
      createdAt: parseMaybeEpoch(message.timestamp),
      updatedAt: parseMaybeEpoch(message.timestamp),
      content: String(message.content || "").trim()
    }))
    .filter((message) => message.content);

  const project = projectNameFromPath(session.cwd || "");
  const createdAt = parseMaybeEpoch(session.started_at) || stat.sourceMtime;
  const updatedAt =
    parseMaybeEpoch(session.ended_at) ||
    [...messages].reverse().find((message) => message.updatedAt)?.updatedAt ||
    createdAt;

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
    title: session.title || titleFromMessages(messages, path.basename(session.cwd || "Hermes session")),
    createdAt,
    updatedAt,
    sourceAppVersion: [session.source, session.model].filter(Boolean).join("/") || "unknown",
    messages
  };
}

function sqliteJson(dbPath, sql) {
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : [];
}
