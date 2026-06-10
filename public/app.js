let state = null;
let activeView = "dashboard";

const els = {
  pageTitle: document.querySelector("#page-title"),
  statusStrip: document.querySelector("#status-strip"),
  syncNow: document.querySelector("#sync-now"),
  openFolder: document.querySelector("#open-folder"),
  lastSync: document.querySelector("#last-sync"),
  schedule: document.querySelector("#schedule"),
  summaryMetrics: document.querySelector("#summary-metrics"),
  channelHealth: document.querySelector("#channel-health"),
  channelsTable: document.querySelector("#channels-table"),
  agentDiscoveryTable: document.querySelector("#agent-discovery-table"),
  sessionsTable: document.querySelector("#sessions-table"),
  sessionSearch: document.querySelector("#session-search"),
  sessionCount: document.querySelector("#session-count"),
  channelFilter: document.querySelector("#channel-filter"),
  projectFilter: document.querySelector("#project-filter"),
  settingsSchedule: document.querySelector("#settings-schedule"),
  settingsWorkspace: document.querySelector("#settings-workspace"),
  settingsRedaction: document.querySelector("#settings-redaction"),
  scheduleForm: document.querySelector("#schedule-form"),
  cadenceSelect: document.querySelector("#cadence-select"),
  intervalField: document.querySelector("#interval-field"),
  intervalMinutes: document.querySelector("#interval-minutes"),
  dailyTimeField: document.querySelector("#daily-time-field"),
  scheduleTime: document.querySelector("#schedule-time"),
  saveSchedule: document.querySelector("#save-schedule"),
  disabledChannels: document.querySelector("#disabled-channels"),
  installLaunchd: document.querySelector("#install-launchd"),
  logOutput: document.querySelector("#log-output"),
  toast: document.querySelector("#toast")
};

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

els.syncNow.addEventListener("click", syncNow);
els.openFolder.addEventListener("click", () => postJson("/api/open", {}));
els.installLaunchd.addEventListener("click", installLaunchd);
els.scheduleForm.addEventListener("submit", saveScheduleSettings);
els.cadenceSelect.addEventListener("change", updateScheduleControls);
els.channelFilter.addEventListener("change", renderSessions);
els.projectFilter.addEventListener("change", renderSessions);
els.sessionSearch.addEventListener("input", renderSessions);

await refresh();

async function refresh() {
  state = await getJson("/api/status");
  renderAll();
  loadLogs();
}

function setView(view) {
  activeView = view;
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.id === view));
  document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  els.pageTitle.textContent = labelForView(view);
  if (view === "logs") loadLogs();
}

function renderAll() {
  renderStatusStrip();
  renderDashboard();
  renderChannels();
  renderAgentDiscovery();
  renderFilters();
  renderSessions();
  renderSettings();
}

function renderStatusStrip() {
  const last = state.lastRun?.summary?.totals || {};
  const items = [
    ["会话 / Sessions", state.counts.sessions],
    ["项目 / Projects", state.counts.projects],
    ["上次新增 / Last Created", last.created || 0],
    ["上次更新 / Last Updated", last.updated || 0]
  ];
  els.statusStrip.innerHTML = items.map(([label, value]) => `
    <div class="stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function renderDashboard() {
  const totals = state.lastRun?.summary?.totals || { discovered: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
  els.lastSync.textContent = state.lastRun
    ? `上次同步 / Last sync ${formatDate(state.lastRun.finishedAt)}`
    : "尚未同步 / Not synced yet";
  els.schedule.textContent = scheduleDescription(state.config.sync);
  els.summaryMetrics.innerHTML = [
    ["发现 / Discovered", totals.discovered || 0],
    ["新增 / Created", totals.created || 0],
    ["更新 / Updated", totals.updated || 0],
    ["跳过 / Skipped", totals.skipped || 0]
  ].map(([label, value]) => `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");

  els.channelHealth.innerHTML = state.config.channels
    .filter((channel) => channel.enabled)
    .map(renderHealthRow)
    .join("") || emptyRow("没有已启用渠道 / No enabled channels");
}

function renderChannels() {
  els.channelsTable.innerHTML = state.config.channels.map((channel) => {
    const status = channelStatus(channel);
    return `
      <tr>
        <td><strong>${escapeHtml(channel.label)}</strong></td>
        <td>${escapeHtml(channel.client)}</td>
        <td>${escapeHtml(channel.adapter)}</td>
        <td class="path" title="${escapeAttr(channel.source)}">${escapeHtml(channel.source || "未配置 / Not configured")}</td>
        <td>${badge(status.label, status.kind)}</td>
        <td>${escapeHtml(channel.sessionCount || 0)}</td>
      </tr>
    `;
  }).join("");
}

function renderAgentDiscovery() {
  els.agentDiscoveryTable.innerHTML = (state.detectedAgents || []).map((agent) => {
    const syncStatus = agent.syncable
      ? { label: "可同步 / Syncable", kind: "ok" }
      : agent.installed
        ? { label: "需配置 / Needs setup", kind: "warn" }
        : { label: "未安装 / Missing", kind: "off" };
    const installStatus = agent.installed
      ? { label: "已检测 / Detected", kind: "ok" }
      : { label: "未检测 / Not found", kind: "off" };
    const paths = [agent.commandPath, agent.appPath].filter(Boolean).join("\n") || "未检测到 / Not found";
    const source = agent.sourcePath || agent.detectedSource || "未配置 / Not configured";
    return `
      <tr>
        <td><strong>${escapeHtml(agent.label)}</strong><div class="muted">${escapeHtml(agent.adapter)}</div></td>
        <td>${badge(installStatus.label, installStatus.kind)}</td>
        <td class="path multi" title="${escapeAttr(paths)}">${escapeHtml(paths)}</td>
        <td class="path multi" title="${escapeAttr(source)}">${escapeHtml(source)}</td>
        <td>${badge(syncStatus.label, syncStatus.kind)}</td>
        <td>${escapeHtml(agent.note || "")}</td>
      </tr>
    `;
  }).join("");
}

function renderFilters() {
  const channels = [["", "全部渠道 / All channels"], ...state.config.channels.map((channel) => [channel.id, channel.label])];
  const projects = [["", "全部项目 / All projects"], ...state.projects.map((project) => [project.project, `${project.channel_label} / ${project.project}`])];
  setOptions(els.channelFilter, channels);
  setOptions(els.projectFilter, projects);
}

function renderSessions() {
  const channel = els.channelFilter.value;
  const project = els.projectFilter.value;
  const query = normalizeSearch(els.sessionSearch.value);
  const sessions = state.recentSessions.filter((session) => {
    if (channel && session.channel_id !== channel) return false;
    if (project && session.project !== project) return false;
    if (query && !sessionMatchesQuery(session, query)) return false;
    return true;
  });
  els.sessionCount.textContent = `显示 ${sessions.length} / ${state.recentSessions.length} 个会话 / Showing ${sessions.length} of ${state.recentSessions.length} sessions`;
  els.sessionsTable.innerHTML = sessions.map((session) => `
    <tr>
      <td>${escapeHtml(formatDate(session.updated_at))}</td>
      <td>${escapeHtml(session.channel_label)}</td>
      <td>${escapeHtml(session.project)}</td>
      <td>${escapeHtml(session.title || session.session_id)}</td>
      <td>${escapeHtml(session.version)}</td>
      <td>${escapeHtml(session.message_count)}</td>
      <td><button class="button secondary" data-open="${escapeAttr(session.markdown_path)}">打开 / Open</button></td>
    </tr>
  `).join("") || `<tr><td colspan="7" class="muted">还没有同步的会话 / No synced sessions yet.</td></tr>`;

  els.sessionsTable.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/open", { path: button.dataset.open }));
  });
}

function sessionMatchesQuery(session, query) {
  const haystack = normalizeSearch([
    session.title,
    session.channel_label,
    session.project,
    session.session_id,
    session.updated_at,
    session.created_at
  ].filter(Boolean).join(" "));
  return haystack.includes(query);
}

function renderSettings() {
  els.settingsSchedule.textContent = `${scheduleDescription(state.config.sync)} (${state.config.sync.timezone})`;
  els.settingsWorkspace.textContent = state.root;
  els.settingsRedaction.textContent = state.config.sync.redact ? "已启用 / Enabled" : "已关闭 / Disabled";
  els.scheduleTime.value = state.config.sync.schedule || "23:00";
  els.intervalMinutes.value = String(state.config.sync.interval_minutes || 60);
  els.cadenceSelect.value = state.config.sync.cadence === "interval" ? "interval" : "daily";
  updateScheduleControls();
  els.disabledChannels.innerHTML = state.config.channels
    .filter((channel) => !channel.enabled)
    .map(renderHealthRow)
    .join("") || emptyRow("没有停用渠道 / No disabled channels");
}

async function loadLogs() {
  const data = await getJson("/api/logs");
  els.logOutput.textContent = data.logs || "暂无日志 / No logs yet.";
}

async function syncNow() {
  els.syncNow.disabled = true;
  els.syncNow.textContent = "同步中 / Syncing";
  try {
    const run = await postJson("/api/sync", {});
    showToast(`同步完成 / Sync complete: ${run.summary.totals.created} 新增, ${run.summary.totals.updated} 更新`);
    await refresh();
  } catch (error) {
    showToast(error.message);
  } finally {
    els.syncNow.disabled = false;
    els.syncNow.textContent = "立即同步 / Sync Now";
  }
}

async function installLaunchd() {
  els.installLaunchd.disabled = true;
  try {
    const result = await postJson("/api/install-launchd", {});
    showToast(`定时任务已安装 / Installed ${result.label}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    els.installLaunchd.disabled = false;
  }
}

async function saveScheduleSettings(event) {
  event.preventDefault();
  els.saveSchedule.disabled = true;
  try {
    const cadenceValue = els.cadenceSelect.value;
    const body =
      cadenceValue === "daily"
        ? { cadence: "daily", schedule: els.scheduleTime.value || "23:00" }
        : {
            cadence: "interval",
            intervalMinutes: Number(els.intervalMinutes.value || 60),
            schedule: els.scheduleTime.value || "23:00"
          };
    const result = await postJson("/api/sync-settings", body);
    showToast(`自动备份已更新 / Auto backup updated: ${scheduleDescription(result.config.sync)}`);
    await refresh();
  } catch (error) {
    showToast(error.message);
  } finally {
    els.saveSchedule.disabled = false;
  }
}

function updateScheduleControls() {
  const isDaily = els.cadenceSelect.value === "daily";
  els.intervalField.hidden = isDaily;
  els.dailyTimeField.hidden = !isDaily;
}

function renderHealthRow(channel) {
  const status = channelStatus(channel);
  return `
    <div class="health-row">
      <div>
        <strong>${escapeHtml(channel.label)}</strong>
        <div class="muted">${escapeHtml(channel.source || "未配置来源 / No source configured")}</div>
      </div>
      ${badge(status.label, status.kind)}
    </div>
  `;
}

function channelStatus(channel) {
  if (!channel.enabled) return { label: "停用 / Disabled", kind: "off" };
  if (!channel.adapterSupported) return { label: "无适配器 / No Adapter", kind: "err" };
  if (!channel.sourceExists && channel.detectedAgent?.installed) return { label: "需配置 / Needs Setup", kind: "warn" };
  if (!channel.sourceExists) return { label: "缺失 / Missing", kind: "err" };
  if (channel.sessionCount > 0) return { label: "已同步 / Synced", kind: "ok" };
  return { label: "就绪 / Ready", kind: "warn" };
}

function badge(label, kind) {
  return `<span class="badge ${kind}">${escapeHtml(label)}</span>`;
}

function emptyRow(text) {
  return `<div class="health-row"><span class="muted">${escapeHtml(text)}</span></div>`;
}

function setOptions(select, options) {
  const current = select.value;
  select.innerHTML = options.map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`).join("");
  if (options.some(([value]) => value === current)) select.value = current;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function labelForView(view) {
  return {
    dashboard: "仪表盘 / Dashboard",
    channels: "渠道 / Channels",
    sessions: "会话 / Sessions",
    settings: "设置 / Settings",
    logs: "日志 / Logs"
  }[view] || "仪表盘 / Dashboard";
}

function scheduleDescription(sync) {
  if (sync?.cadence === "interval") {
    const minutes = Number(sync.interval_minutes || 60);
    const zh = minutes % 60 === 0
      ? `每 ${minutes / 60} 小时自动备份`
      : `每 ${minutes} 分钟自动备份`;
    const en = minutes % 60 === 0
      ? `Every ${minutes / 60} hour${minutes / 60 === 1 ? "" : "s"}`
      : `Every ${minutes} minute${minutes === 1 ? "" : "s"}`;
    return `${zh} / ${en}`;
  }
  return `每天 ${sync?.schedule || "23:00"} 自动备份 / Daily at ${sync?.schedule || "23:00"}`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#039;");
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}
