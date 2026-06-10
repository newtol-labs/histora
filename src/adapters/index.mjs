import { adapter as codexJsonl } from "./codex-jsonl.mjs";
import { adapter as claudeJsonl } from "./claude-jsonl.mjs";
import { adapter as geminiJson } from "./gemini-json.mjs";
import { adapter as hermesSqlite } from "./hermes-sqlite.mjs";
import { adapter as openclawJson } from "./openclaw-json.mjs";
import { adapter as opencodeSqlite } from "./opencode-sqlite.mjs";

const adapters = new Map([
  [codexJsonl.id, codexJsonl],
  [claudeJsonl.id, claudeJsonl],
  [geminiJson.id, geminiJson],
  [hermesSqlite.id, hermesSqlite],
  [openclawJson.id, openclawJson],
  [opencodeSqlite.id, opencodeSqlite]
]);

export function getAdapter(id) {
  return adapters.get(id) || null;
}

export function supportedAdapters() {
  return [...adapters.keys()];
}
