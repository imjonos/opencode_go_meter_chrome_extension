import { displayPercent, loadQuota, usageLabel, toolbarState } from "./opencode.mjs";
import { HISTORY_LENGTH, HISTORY_STEP } from "./history.mjs";
import { interfaceLanguage, normalizeSettings, THRESHOLDS, translator } from "./settings.mjs";

const ALARM = "go-quota";

const BADGE_COLORS = {
  healthy: "#176345",
  warning: "#815300",
  critical: "#a42939",
  muted: "#4b5563",
};
let queue = Promise.resolve();

function serialize(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

function locale(settings) {
  return interfaceLanguage(settings.language, chrome.i18n.getUILanguage());
}

async function updateToolbar(state, settings) {
  const language = locale(settings);
  const t = translator(language);
  const { showRemaining } = settings;
  const { badge, tone } = toolbarState(state, Date.now(), settings);
  const title = state.snapshot && badge !== "!"
    ? ["OpenCode Go · " + t(showRemaining ? "осталось" : "израсходовано"), ...state.snapshot.windows.map(({ label, used }) =>
      t(label) + " — " + (used === null ? t("нет данных") : usageLabel(displayPercent(used, showRemaining), language)))].join("\n")
    : "OpenCode Go · " + t(badge === "!" ? "нет свежих данных" : "откройте расширение");
  await Promise.all([
    chrome.action.setBadgeText({ text: badge }),
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[tone] }),
    chrome.action.setBadgeTextColor({ color: "#ffffff" }),
    chrome.action.setTitle({ title }),
  ]);
}

function nextHistory(previous, snapshot) {
  const history = previous.filter(({ time }) => time >= snapshot.time - HISTORY_LENGTH);
  const last = history.at(-1);
  const point = {
    time: snapshot.time,
    used: snapshot.windows.map(({ used }) => used),
    monthlyReset: snapshot.windows.find(({ id }) => id === "month")?.resetsAt ?? null,
  };
  if (!last || Math.floor(last.time / HISTORY_STEP) !== Math.floor(point.time / HISTORY_STEP)) {
    history.push(point);
  } else {
    history[history.length - 1] = point;
  }
  return history;
}

function crossedThresholds(previous, snapshot, enabledThresholds) {
  const alerts = [];
  const levels = {};
  for (const window of snapshot.windows) {
    const last = previous[window.id];
    if (window.used === null) {
      if (last) levels[window.id] = last;
      continue;
    }
    const prior = last?.resetsAt && last.resetsAt <= snapshot.time && window.resetsAt !== last.resetsAt
      ? 0 : last?.threshold ?? 0;
    const threshold = THRESHOLDS.findLast((value) => window.used >= value) ?? 0;
    if (enabledThresholds.some((value) => value > prior && value <= threshold)) alerts.push(window);
    levels[window.id] = { threshold: Math.max(prior, threshold), resetsAt: window.resetsAt };
  }
  return { alerts, levels };
}

async function refresh({ force = false, workspaceId } = {}) {
  const { state = {}, settings: storedSettings = {} } = await chrome.storage.local.get(["state", "settings"]);
  const settings = normalizeSettings(storedSettings);
  if (!force && Date.now() - (state.attemptedAt ?? 0) < 30_000) {
    await updateToolbar(state, settings);
    return;
  }

  const changingWorkspace = workspaceId !== undefined;
  const preferred = changingWorkspace ? workspaceId : storedSettings.workspaceId;
  const base = changingWorkspace
    ? { workspaces: state.workspaces, workspaceId, history: [] }
    : state;
  if (changingWorkspace) {
    await chrome.storage.local.set({ settings: { ...storedSettings, workspaceId }, state: base });
    await updateToolbar(base, settings);
  }

  let result;
  try {
    result = await loadQuota(preferred || base.snapshot?.workspaceId);
  } catch (error) {
    const problem = { code: error.code ?? "network", status: error.status ?? null };
    const safeBase = problem.code === "login" ? {} : base;
    const next = { ...safeBase, error: problem, attemptedAt: Date.now() };
    await chrome.storage.local.set({ state: next });
    await updateToolbar(next, settings);
    return;
  }

  const time = Date.now();
  const { windows, workspaces } = result;
  const sameWorkspace = base.snapshot?.workspaceId === result.workspaceId;
  const snapshot = windows ? { windows, time, workspaceId: result.workspaceId } : null;
  const { alerts, levels } = snapshot
    ? crossedThresholds(sameWorkspace ? base.levels ?? {} : {}, snapshot, settings.thresholds)
    : { alerts: [], levels: {} };
  const next = {
    snapshot,
    workspaces,
    workspaceId: result.workspaceId,
    attemptedAt: time,
    error: snapshot ? null : { code: "subscription" },
    history: snapshot ? nextHistory(sameWorkspace ? base.history ?? [] : [], snapshot) : [],
    levels,
  };
  await chrome.storage.local.set({ state: next });
  await updateToolbar(next, settings);
  if (settings.notifications && alerts.length) {
    const language = locale(settings);
    const t = translator(language);
    await notify(t("лимит"), alerts.map(({ label, used }) =>
      t(label) + " — " + usageLabel(used, language) + " " + t("израсходовано")).join("\n"));
  }
}

async function notify(title, message) {
  await chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/meter-128.png",
    title: "OpenCode Go · " + title,
    message,
  });
}

async function ensureAlarm() {
  const { settings } = await chrome.storage.local.get("settings");
  const { refreshMinutes } = normalizeSettings(settings);
  const alarm = await chrome.alarms.get(ALARM);
  if (alarm?.periodInMinutes !== refreshMinutes) {
    await chrome.alarms.create(ALARM, { periodInMinutes: refreshMinutes });
  }
}

function schedule(task) {
  serialize(task).catch(() => console.warn("OpenCode Go Meter: фоновая операция не выполнена."));
}

function start() {
  schedule(async () => {
    await ensureAlarm();
    await refresh({ force: true });
  });
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === ALARM) schedule(() => refresh({ force: true }));
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.url !== chrome.runtime.getURL("popup.html")) return false;
  const task = async () => {
    await ensureAlarm();
    if (message?.type === "refresh") {
      await refresh({ force: message.force === true });
    } else if (message?.type === "workspace") {
      const { state } = await chrome.storage.local.get("state");
      if (!state?.workspaces?.some(({ id }) => id === message.id)) return false;
      await refresh({ force: true, workspaceId: message.id });
    } else if (message?.type === "settings" && message.values && typeof message.values === "object") {
      const { state = {}, settings: previous = {} } = await chrome.storage.local.get(["state", "settings"]);
      const settings = normalizeSettings({ ...previous, ...message.values });
      await chrome.storage.local.set({ settings: { ...previous, ...settings } });
      await Promise.all([ensureAlarm(), updateToolbar(state, settings)]);
    } else if (message?.type === "test-notification") {
      if (await chrome.notifications.getPermissionLevel() !== "granted") return false;
      const { settings } = await chrome.storage.local.get("settings");
      const t = translator(locale(normalizeSettings(settings)));
      await notify(t("Тест уведомлений"), t("Уведомления OpenCode Go Meter работают."));
    } else {
      return false;
    }
    return true;
  };
  serialize(task).then(respond, () => respond(false));
  return true;
});
