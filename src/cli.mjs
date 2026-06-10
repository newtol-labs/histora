#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { installLaunchd } from "./launchd.mjs";
import { getStatus, runSync } from "./sync.mjs";

const command = process.argv[2] || "help";
const root = process.env.HISTORA_WORKSPACE || process.env.CHATHUB_WORKSPACE || process.cwd();

try {
  if (command === "sync") {
    const run = await runSync({ root });
    printJson(run.summary);
  } else if (command === "status") {
    printJson(getStatus(root));
  } else if (command === "doctor") {
    printDoctor();
  } else if (command === "install-launchd") {
    printJson(installLaunchd(root));
  } else if (command === "serve") {
    await import("./server.mjs");
  } else if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}

function printHelp() {
  console.log(`Histora

Usage:
  histora sync
  histora status
  histora doctor
  histora install-launchd
  histora serve

Legacy alias:
  chathub sync
  chathub status
  chathub doctor
  chathub install-launchd
  chathub serve
`);
}

function printDoctor() {
  const status = getStatus(root);
  const checks = [];
  checks.push({ name: "Node", ok: true, detail: process.version });
  checks.push({ name: "sqlite3", ok: hasCommand("sqlite3"), detail: hasCommand("sqlite3") ? "available" : "missing" });
  checks.push({ name: "Workspace", ok: fs.existsSync(status.root), detail: status.root });
  for (const channel of status.config.channels) {
    checks.push({
      name: `Source: ${channel.label}`,
      ok: !channel.enabled || channel.sourceExists,
      detail: channel.enabled ? channel.source : "disabled"
    });
    checks.push({
      name: `Adapter: ${channel.label}`,
      ok: !channel.enabled || channel.adapterSupported,
      detail: channel.adapter
    });
  }
  printJson({ checks });
}

function hasCommand(name) {
  try {
    execFileSync("which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
