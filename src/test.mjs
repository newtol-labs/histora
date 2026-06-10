import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adapter as geminiJsonAdapter } from "./adapters/gemini-json.mjs";
import { adapter as hermesSqliteAdapter } from "./adapters/hermes-sqlite.mjs";
import { adapter as openclawJsonAdapter } from "./adapters/openclaw-json.mjs";
import { detectAgents } from "./discovery.mjs";
import { CONFIG_FILE, LEGACY_CONFIG_FILE, parseConfig, updateSyncConfig } from "./config.mjs";
import { renderSessionMarkdown } from "./markdown.mjs";
import { ensureState } from "./state.mjs";
import { normalizeRecord } from "./sync.mjs";

const parsed = parseConfig(`
workspace: /tmp/histora
sync:
  schedule: "23:00"
  cadence: interval
  interval_minutes: 30
  redact: true
channels:
  - id: codex
    label: Codex
    enabled: true
`);

assert.equal(parsed.workspace, "/tmp/histora");
assert.equal(parsed.sync.schedule, "23:00");
assert.equal(parsed.sync.cadence, "interval");
assert.equal(parsed.sync.interval_minutes, 30);
assert.equal(parsed.sync.redact, true);
assert.equal(parsed.channels[0].id, "codex");
assert.equal(parsed.channels[0].enabled, true);

const normalized = normalizeRecord(
  {
    project: "Test",
    title: "Secret",
    messages: [
      {
        role: "user",
        content: "token: abcdefghijklmnopqrstuvwxyz"
      },
      {
        role: "system",
        content: "hidden"
      }
    ]
  },
  { sync: { redact: true } }
);
assert.equal(normalized.messages.length, 1);
assert.match(normalized.messages[0].content, /\[REDACTED\]/);

const markdown = renderSessionMarkdown(
  {
    channelLabel: "Codex",
    client: "CLI",
    project: "Test",
    sessionId: "abc",
    title: "Hello",
    sourceType: "jsonl",
    sourcePath: "/tmp/source.jsonl",
    sourceAppVersion: "1.0.0",
    adapterVersion: "test-v1",
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    messages: [{ role: "user", createdAt: "2026-06-03T00:00:00.000Z", content: "Hi" }]
  },
  1,
  "hash",
  "2026-06-03T01:00:00.000Z"
);
assert.match(markdown, /^---/);
assert.match(markdown, /histora_schema: 1/);
assert.match(markdown, /version: 1/);
assert.match(markdown, /### User/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "histora-test-"));
fs.writeFileSync(
  path.join(tempRoot, LEGACY_CONFIG_FILE),
  `workspace: ${tempRoot}

sync:
  schedule: "23:00"
  cadence: daily
  interval_minutes: 0
  timezone: Asia/Shanghai
  redact: true

channels:
  - id: codex
    label: Codex
    client: CLI/Desktop
    adapter: codex-jsonl
    source: ~/.codex/sessions
    enabled: true
`,
  "utf8"
);
const updatedConfig = updateSyncConfig(tempRoot, { cadence: "interval", intervalMinutes: 17, schedule: "7:05" });
assert.equal(updatedConfig.sync.cadence, "interval");
assert.equal(updatedConfig.sync.interval_minutes, 17);
assert.equal(updatedConfig.sync.schedule, "07:05");

const state = ensureState(tempRoot);
assert.ok(fs.existsSync(state.db));

const geminiExportPath = path.join(tempRoot, "gemini-export.json");
fs.writeFileSync(
  geminiExportPath,
  JSON.stringify({
    conversations: [
      {
        id: "gemini-session-1",
        title: "Gemini CLI export test",
        project_name: "Gemini Project",
        messages: [
          { role: "user", content: "Hello Gemini", created_at: "2026-06-03T00:00:00.000Z" },
          { role: "assistant", content: "Hello from Gemini", created_at: "2026-06-03T00:01:00.000Z" }
        ]
      }
    ]
  }),
  "utf8"
);
const geminiRecords = geminiJsonAdapter.discover({
  id: "gemini-cli",
  label: "Gemini CLI",
  client: "CLI",
  source: geminiExportPath
});
assert.equal(geminiRecords.length, 1);
assert.equal(geminiRecords[0].adapterVersion, "gemini-json-v1");
assert.equal(geminiRecords[0].project, "Gemini Project");
assert.equal(geminiRecords[0].messages.length, 2);

const openclawPath = path.join(tempRoot, "openclaw.jsonl");
fs.writeFileSync(
  openclawPath,
  [
    JSON.stringify({ session_id: "openclaw-1", role: "user", content: "Hello OpenClaw", timestamp: 1780502400 }),
    JSON.stringify({ session_id: "openclaw-1", role: "assistant", content: "Hello from OpenClaw", timestamp: 1780502460 })
  ].join("\n"),
  "utf8"
);
const openclawRecords = openclawJsonAdapter.discover({
  id: "openclaw",
  label: "OpenClaw",
  client: "CLI",
  source: openclawPath
});
assert.equal(openclawRecords.length, 1);
assert.equal(openclawRecords[0].adapterVersion, "openclaw-json-v1");
assert.equal(openclawRecords[0].messages.length, 2);

const hermesDb = path.join(tempRoot, "hermes-state.db");
execFileSync("sqlite3", [
  hermesDb,
  `create table sessions (
      id text primary key, source text, model text, title text, cwd text,
      started_at real, ended_at real, end_reason text, message_count integer
    );
    create table messages (
      id integer primary key autoincrement, session_id text, role text, content text,
      timestamp real, active integer default 1
    );
    insert into sessions (id, source, model, title, cwd, started_at, ended_at, message_count)
      values ('hermes-1', 'cli', 'test-model', 'Hermes export test', '/tmp/demo', 1780502400, 1780502460, 2);
    insert into messages (session_id, role, content, timestamp, active)
      values ('hermes-1', 'user', 'Hello Hermes', 1780502400, 1),
             ('hermes-1', 'assistant', 'Hello from Hermes', 1780502460, 1);`
]);
const hermesRecords = hermesSqliteAdapter.discover({
  id: "hermes-agent",
  label: "Hermes Agent",
  client: "CLI/Desktop",
  source: hermesDb
});
assert.equal(hermesRecords.length, 1);
assert.equal(hermesRecords[0].adapterVersion, "hermes-sqlite-v1");
assert.equal(hermesRecords[0].messages.length, 2);

const historaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "histora-config-"));
fs.writeFileSync(
  path.join(historaRoot, CONFIG_FILE),
  `workspace: ${historaRoot}
channels: []
`,
  "utf8"
);
const detected = detectAgents({ channels: [{ id: "hermes-agent", source: hermesDb, adapter: "hermes-sqlite" }] });
assert.ok(detected.some((agent) => agent.id === "hermes-agent"));

console.log("ok");
