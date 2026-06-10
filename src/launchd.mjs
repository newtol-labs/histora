import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfig } from "./config.mjs";
import { ensureDir } from "./utils.mjs";

const LABEL = "com.jet.histora.sync";
const LEGACY_LABEL = "com.jet.chathub.sync";
const WINDOWS_TASK_NAME = "Histora Sync";
const LEGACY_WINDOWS_TASK_NAME = "Chathub Sync";

export function launchdPlistPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

export function installLaunchd(root = process.cwd()) {
  const config = readConfig(root);
  const [hour, minute] = String(config.sync.schedule || "23:00").split(":").map(Number);
  const cadence = config.sync.cadence === "interval" ? "interval" : "daily";
  const intervalMinutes = normalizeSchedulerInterval(config.sync.interval_minutes);
  const runner = launchdRunner(root);

  if (process.platform === "win32") {
    return installWindowsTask(root, config, runner, {
      cadence,
      intervalMinutes,
      hour: Number.isFinite(hour) ? hour : 23,
      minute: Number.isFinite(minute) ? minute : 0
    });
  }

  if (process.platform !== "darwin") {
    throw new Error("Automatic scheduling is currently supported on macOS and Windows.");
  }

  const plistPath = launchdPlistPath();
  const supportDir = path.join(os.homedir(), "Library", "Application Support", "Histora");
  const scriptPath = path.join(supportDir, "histora-sync-launchd.sh");
  ensureDir(path.dirname(plistPath));
  ensureDir(supportDir);
  ensureDir(path.join(root, ".histora", "logs"));
  fs.writeFileSync(scriptPath, renderMacLaunchdScript(runner), "utf8");
  fs.chmodSync(scriptPath, 0o755);

  const plist = renderPlist({
    label: LABEL,
    programArguments: ["/bin/sh", scriptPath],
    environment: runner.environment,
    workingDirectory: supportDir,
    cadence,
    intervalSeconds: Math.max(60, intervalMinutes * 60),
    hour: Number.isFinite(hour) ? hour : 23,
    minute: Number.isFinite(minute) ? minute : 0,
    stdout: path.join(root, ".histora", "logs", "launchd.out.log"),
    stderr: path.join(root, ".histora", "logs", "launchd.err.log")
  });
  fs.writeFileSync(plistPath, plist, "utf8");

  unloadIfPresent(plistPath);
  removeLegacyPlist();
  loadPlist(plistPath);
  return {
    label: LABEL,
    scheduler: "macos-launchd",
    plistPath,
    taskScript: scriptPath,
    cadence,
    intervalMinutes: cadence === "interval" ? intervalMinutes : 0,
    schedule: config.sync.schedule,
    programArguments: runner.programArguments
  };
}

function installWindowsTask(root, config, runner, schedule) {
  const taskScript = path.join(root, ".histora", "histora-sync-task.cmd");
  ensureDir(path.dirname(taskScript));
  fs.writeFileSync(taskScript, renderWindowsTaskScript(runner), "utf8");
  removeLegacyWindowsTask();

  const args = [
    "/Create",
    "/TN",
    WINDOWS_TASK_NAME,
    "/TR",
    quoteWindowsTaskPath(taskScript),
    "/F"
  ];

  if (schedule.cadence === "interval") {
    args.push("/SC", "MINUTE", "/MO", String(schedule.intervalMinutes));
  } else {
    args.push(
      "/SC",
      "DAILY",
      "/ST",
      `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`
    );
  }

  execFileSync("schtasks", args, { stdio: "ignore" });
  return {
    label: WINDOWS_TASK_NAME,
    scheduler: "windows-task-scheduler",
    taskScript,
    cadence: schedule.cadence,
    intervalMinutes: schedule.cadence === "interval" ? schedule.intervalMinutes : 0,
    schedule: config.sync.schedule,
    programArguments: runner.programArguments
  };
}

function launchdRunner(root) {
  const cliPath = path.join(root, "src", "cli.mjs");
  const environment = {
    HISTORA_WORKSPACE: root
  };

  if (process.versions.electron || !fs.existsSync(cliPath)) {
    return {
      programArguments: [process.execPath, "--histora-sync"],
      environment
    };
  }

  return {
    programArguments: [process.execPath, cliPath, "sync"],
    environment
  };
}

function normalizeSchedulerInterval(value) {
  const minutes = Math.round(Number(value || 0));
  if (!Number.isFinite(minutes) || minutes < 1) return 60;
  return Math.min(minutes, 1439);
}

function removeLegacyPlist() {
  const legacyPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LEGACY_LABEL}.plist`);
  unloadIfPresent(legacyPath);
  try {
    fs.unlinkSync(legacyPath);
  } catch {
    // It is fine if the legacy plist does not exist.
  }
}

function removeLegacyWindowsTask() {
  try {
    execFileSync("schtasks", ["/Delete", "/TN", LEGACY_WINDOWS_TASK_NAME, "/F"], { stdio: "ignore" });
  } catch {
    // It is fine if the legacy task does not exist.
  }
}

function unloadIfPresent(plistPath) {
  const domain = launchctlDomain();
  try {
    execFileSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
    return;
  } catch {
    // Older macOS versions or unloaded agents may not support/need bootout.
  }

  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  } catch {
    // It is fine if the agent was not loaded yet.
  }
}

function loadPlist(plistPath) {
  const domain = launchctlDomain();
  try {
    execFileSync("launchctl", ["bootstrap", domain, plistPath], { stdio: "ignore" });
    execFileSync("launchctl", ["enable", `${domain}/${LABEL}`], { stdio: "ignore" });
    return;
  } catch {
    // Fall back to the older launchctl API on older systems.
  }

  execFileSync("launchctl", ["load", "-w", plistPath], { stdio: "ignore" });
}

function launchctlDomain() {
  return `gui/${typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid}`;
}

function renderPlist(options) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(options.label)}</string>
  <key>ProgramArguments</key>
  <array>
${options.programArguments.map((argument) => `    <string>${escapeXml(argument)}</string>`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(options.environment || {})
  .map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`)
  .join("\n")}
  </dict>
  <key>WorkingDirectory</key>
  <string>${escapeXml(options.workingDirectory)}</string>
${renderSchedule(options)}
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ExitTimeOut</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(options.stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.stderr)}</string>
</dict>
</plist>
`;
}

function renderMacLaunchdScript(runner) {
  const command = runner.programArguments.map(quoteShArgument).join(" ");
  const workspace = runner.environment.HISTORA_WORKSPACE;
  return `#!/bin/sh
set -u

child_pid=""
cleanup() {
  if [ -n "$child_pid" ]; then
    kill "$child_pid" 2>/dev/null || true
  fi
  exit 143
}
trap cleanup TERM INT HUP

export HISTORA_WORKSPACE=${quoteShArgument(workspace)}
export CHATHUB_WORKSPACE=${quoteShArgument(workspace)}

echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') launchd-start root=$HISTORA_WORKSPACE"
${command} &
child_pid=$!
elapsed=0
timeout=600

while kill -0 "$child_pid" 2>/dev/null; do
  if [ "$elapsed" -ge "$timeout" ]; then
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') launchd-timeout pid=$child_pid timeout=$timeout"
    kill "$child_pid" 2>/dev/null || true
    sleep 5
    kill -9 "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
    exit 124
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

wait "$child_pid"
status=$?
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') launchd-exit status=$status runtime=$elapsed"
exit "$status"
`;
}

function renderWindowsTaskScript(runner) {
  return [
    "@echo off",
    `set "HISTORA_WORKSPACE=${escapeCmdSet(runner.environment.HISTORA_WORKSPACE)}"`,
    `set "CHATHUB_WORKSPACE=${escapeCmdSet(runner.environment.HISTORA_WORKSPACE)}"`,
    runner.programArguments.map(quoteCmdArgument).join(" "),
    ""
  ].join("\r\n");
}

function renderSchedule(options) {
  if (options.cadence === "interval") {
    return `  <key>StartInterval</key>
  <integer>${options.intervalSeconds}</integer>`;
  }
  return `  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${options.hour}</integer>
    <key>Minute</key>
    <integer>${options.minute}</integer>
  </dict>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function quoteShArgument(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}

function quoteWindowsTaskPath(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function quoteCmdArgument(value) {
  return `"${String(value).replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

function escapeCmdSet(value) {
  return String(value).replace(/%/g, "%%").replace(/"/g, '""');
}
