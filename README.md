# Histora

Histora is a local GUI and sync agent for AI conversation sessions. It detects installed agents, reads supported local session stores or exported conversation files, renders them as Markdown, and keeps a small SQLite state database for versioning and incremental updates.

## Run

```sh
npm start
```

Open the URL printed by the server.

## Desktop App

Run the cross-platform desktop app in development:

```sh
npm run desktop
```

Build distributable apps:

```sh
npm run dist:mac
npm run dist:win
```

`dist:win` targets Windows x64.

For a quick package smoke test on the current platform:

```sh
npm run pack:mac
npm run pack:win
```

The packaged macOS app is written under `release/mac-arm64/Histora.app` when built on Apple Silicon.
The unpacked Windows app is written under `release/win-unpacked/Histora.exe`.

The GUI uses bilingual Chinese/English labels and includes a schedule selector for:

- Sync by a custom minute interval from 1 to 1439 minutes
- Sync daily at a fixed time

Saving the schedule from the GUI rewrites `histora.config.yaml` and reinstalls the system scheduler: macOS uses `launchd`, and Windows uses Task Scheduler. Existing `chathub.config.yaml` files are still readable as a legacy fallback.

On macOS, Histora installs a small watchdog script in `~/Library/Application Support/Histora/` and points `launchd` at that script. The watchdog keeps the workspace path in `HISTORA_WORKSPACE`, records launch/exit lines in `.histora/logs/launchd.out.log`, and stops a stuck sync after 10 minutes so the next scheduled run is not blocked.

## CLI

```sh
npm run sync
npm run status
npm run doctor
npm run install-launchd
```

## Output

Synced sessions are written to:

```text
channels/<channel>/projects/<project>/sessions/*.md
```

Indexes are written to each project folder and to `_index.md`.

## Agent Detection

Histora checks installed agents on startup and status refresh. The GUI shows command paths, app paths, configured data sources, and whether each source is immediately syncable.

Currently supported direct sources:

- Codex: `~/.codex/sessions`
- Claude Code: `~/.claude/projects`
- OpenCode: `~/.local/share/opencode/opencode.db`
- Hermes Agent: `~/.hermes/state.db`

Supported export/import sources:

- Gemini CLI: JSON or JSONL conversation export, or a configured sessions directory
- OpenClaw: JSON or JSONL conversation export, or a configured sessions directory
