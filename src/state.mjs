import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./utils.mjs";

export function statePaths(root) {
  const dir = stateDir(root);
  return {
    dir,
    db: path.join(dir, "state.sqlite"),
    logs: path.join(dir, "logs"),
    history: path.join(dir, "history"),
    lastRun: path.join(dir, "last-run.json")
  };
}

function stateDir(root) {
  const current = path.join(root, ".histora");
  const legacy = path.join(root, ".chathub");
  if (!fs.existsSync(current) && fs.existsSync(legacy)) {
    try {
      fs.renameSync(legacy, current);
    } catch {
      return legacy;
    }
  }
  return current;
}

export function ensureState(root) {
  const paths = statePaths(root);
  ensureDir(paths.dir);
  ensureDir(paths.logs);
  ensureDir(paths.history);
  runSql(paths.db, `
    create table if not exists sessions (
      source_key text primary key,
      channel_id text not null,
      channel_label text not null,
      client text,
      project text not null,
      session_id text not null,
      title text,
      source_type text,
      source_path text,
      source_mtime text,
      source_size integer,
      markdown_path text not null,
      content_hash text not null,
      version integer not null,
      message_count integer not null,
      created_at text,
      updated_at text,
      synced_at text not null
    );
  `);
  runSql(paths.db, `
    create table if not exists runs (
      id integer primary key autoincrement,
      started_at text not null,
      finished_at text not null,
      status text not null,
      summary_json text not null
    );
  `);
  return paths;
}

export function runSql(dbPath, sql) {
  return execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
}

export function queryJson(dbPath, sql) {
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  if (!output) return [];
  return JSON.parse(output);
}

export function getSessionState(root, sourceKey) {
  const { db } = ensureState(root);
  const rows = queryJson(db, `select * from sessions where source_key = ${sqlString(sourceKey)} limit 1;`);
  return rows[0] || null;
}

export function listSessionStates(root, filters = {}) {
  const { db } = ensureState(root);
  const where = [];
  if (filters.channelId) where.push(`channel_id = ${sqlString(filters.channelId)}`);
  if (filters.project) where.push(`project = ${sqlString(filters.project)}`);
  const sql = `
    select *
    from sessions
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by datetime(updated_at) desc, datetime(synced_at) desc
    limit ${Number(filters.limit || 500)}
  `;
  return queryJson(db, sql);
}

export function listProjects(root) {
  const { db } = ensureState(root);
  return queryJson(
    db,
    `select channel_id, channel_label, project, count(*) as session_count, max(updated_at) as updated_at
     from sessions
     group by channel_id, channel_label, project
     order by channel_label, project;`
  );
}

export function upsertSessionState(root, record) {
  const { db } = ensureState(root);
  runSql(db, `
    insert into sessions (
      source_key, channel_id, channel_label, client, project, session_id, title,
      source_type, source_path, source_mtime, source_size, markdown_path,
      content_hash, version, message_count, created_at, updated_at, synced_at
    ) values (
      ${sqlString(record.sourceKey)},
      ${sqlString(record.channelId)},
      ${sqlString(record.channelLabel)},
      ${sqlString(record.client || "")},
      ${sqlString(record.project)},
      ${sqlString(record.sessionId)},
      ${sqlString(record.title || "")},
      ${sqlString(record.sourceType || "")},
      ${sqlString(record.sourcePath || "")},
      ${sqlString(record.sourceMtime || "")},
      ${Number(record.sourceSize || 0)},
      ${sqlString(record.markdownPath)},
      ${sqlString(record.contentHash)},
      ${Number(record.version || 1)},
      ${Number(record.messageCount || 0)},
      ${sqlString(record.createdAt || "")},
      ${sqlString(record.updatedAt || "")},
      ${sqlString(record.syncedAt)}
    )
    on conflict(source_key) do update set
      channel_id = excluded.channel_id,
      channel_label = excluded.channel_label,
      client = excluded.client,
      project = excluded.project,
      session_id = excluded.session_id,
      title = excluded.title,
      source_type = excluded.source_type,
      source_path = excluded.source_path,
      source_mtime = excluded.source_mtime,
      source_size = excluded.source_size,
      markdown_path = excluded.markdown_path,
      content_hash = excluded.content_hash,
      version = excluded.version,
      message_count = excluded.message_count,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      synced_at = excluded.synced_at;
  `);
}

export function recordRun(root, run) {
  const paths = ensureState(root);
  const summaryJson = JSON.stringify(run.summary);
  runSql(paths.db, `
    insert into runs (started_at, finished_at, status, summary_json)
    values (
      ${sqlString(run.startedAt)},
      ${sqlString(run.finishedAt)},
      ${sqlString(run.status)},
      ${sqlString(summaryJson)}
    );
  `);
  fs.writeFileSync(paths.lastRun, JSON.stringify(run, null, 2), "utf8");
  const logPath = path.join(paths.logs, "sync.log");
  fs.appendFileSync(logPath, `${run.finishedAt} ${run.status} ${summaryJson}\n`, "utf8");
}

export function lastRuns(root, limit = 20) {
  const { db } = ensureState(root);
  return queryJson(
    db,
    `select id, started_at, finished_at, status, summary_json
     from runs
     order by id desc
     limit ${Number(limit)};`
  ).map((run) => ({
    ...run,
    summary: safeJson(run.summary_json)
  }));
}

export function readLastRun(root) {
  const { lastRun } = ensureState(root);
  if (!fs.existsSync(lastRun)) return null;
  return safeJson(fs.readFileSync(lastRun, "utf8"));
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function sqlString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}
