import { displayPercent, ORIGIN, quotaTone, usageLabel, staleAfter } from "./opencode.mjs";

import { observedUsage } from "./history.mjs";
import { interfaceLanguage, intervalLabel, normalizeSettings, REFRESH_OPTIONS, translator } from "./settings.mjs";

const $ = (id) => document.getElementById(id);
const status = $("status");
const refresh = $("refresh");
const workspace = $("workspace");
const form = $("settings-form");
const testNotification = $("test-notification");
const thresholdInputs = [...form.querySelectorAll('[name="thresholds"]')];
const browserLanguage = chrome.i18n.getUILanguage();
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
let settings = normalizeSettings();
let state = {};
let busy = false;
let language, t, resetDate, clock, dayLabel, decimal;
let notificationPermission;
let notificationResult;
let testingNotification = false;

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme === "system"
    ? (systemTheme.matches ? "dark" : "light") : settings.theme;
}

function applySettings(values) {
  settings = normalizeSettings(values);
  language = interfaceLanguage(settings.language, browserLanguage);
  t = translator(language);
  document.documentElement.lang = language;
  resetDate = new Intl.DateTimeFormat(language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  clock = new Intl.DateTimeFormat(language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  dayLabel = new Intl.DateTimeFormat(language, { day: "2-digit", month: "2-digit" });
  decimal = new Intl.NumberFormat(language, { maximumFractionDigits: 2 });
  applyTheme();

  for (const element of document.querySelectorAll("[data-text]")) element.textContent = t(element.dataset.text);
  for (const element of document.querySelectorAll("[data-label]")) {
    element.setAttribute("aria-label", t(element.dataset.label));
    element.title = t(element.dataset.label);
  }
  $("refresh-interval").replaceChildren(...REFRESH_OPTIONS.map((minutes) =>
    new Option(intervalLabel(minutes, language), minutes)));
  for (const name of ["language", "theme", "refreshMinutes"]) form.elements.namedItem(name).value = settings[name];
  for (const name of ["notifications", "showRemaining"]) form.elements.namedItem(name).checked = settings[name];
  for (const input of thresholdInputs) input.checked = settings.thresholds.includes(Number(input.value));
  const languageNames = new Intl.DisplayNames([language], { type: "language" });
  $("browser-language").textContent = t("Язык браузера") + " · " + languageNames.of(browserLanguage);
  drawNotificationStatus();
  draw();
}

function drawNotificationStatus() {
  const permission = $("notification-permission");
  permission.hidden = notificationPermission === undefined;
  permission.textContent = t(notificationPermission === "granted"
    ? "Уведомления разрешены браузером." : "Уведомления заблокированы браузером.");
  testNotification.disabled = testingNotification || notificationPermission === "denied";
  const result = $("notification-result");
  result.hidden = notificationResult === undefined;
  result.textContent = notificationResult === undefined ? "" : t(notificationResult
    ? "Тестовое уведомление отправлено." : "Не удалось отправить тестовое уведомление.");
}

function resetLabel(window) {
  if (!window.resetsAt) return t("Время сброса неизвестно");
  const date = resetDate.format(window.resetsAt);
  const minutes = Math.ceil((window.resetsAt - Date.now()) / 60_000);
  if (minutes <= 0) return t("Время сброса прошло · ждём обновления");
  const parts = [
    [Math.floor(minutes / 1440), "дн."],
    [Math.floor(minutes / 60) % 24, "ч"],
    [minutes % 60, "мин"],
  ].filter(([value]) => value).slice(0, 2);
  return t("Сброс") + " " + date + " · " + t("через") + " " + parts.map(([value, unit]) => value + " " + t(unit)).join(" ");
}

function drawMeters(windows) {
  $("windows").replaceChildren(...windows.map((window) => {
    const row = $("meter-template").content.firstElementChild.cloneNode(true);
    row.dataset.tone = quotaTone(window.used);
    const label = t(window.label);
    const percent = window.used === null ? null : displayPercent(window.used, settings.showRemaining);
    row.querySelector("h3").textContent = label;
    row.querySelector(".value").textContent = percent === null ? "—" : usageLabel(percent, language);
    row.querySelector(".reset").textContent = percent === null ? t("нет данных") : resetLabel(window);
    const bar = row.querySelector("progress");
    bar.value = percent ?? 0;
    bar.hidden = percent === null;
    bar.setAttribute("aria-label", label + " · " + t(settings.showRemaining ? "осталось" : "израсходовано"));
    return row;
  }));
}

function svgNode(name, attrs) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

function drawHistory(history, windows) {
  const chart = $("chart");
  chart.hidden = history.length < 2;
  $("history-note").textContent = t(chart.hidden
    ? "График появится после нескольких замеров."
    : settings.showRemaining
      ? "Остаток от 0 до 100% за последние 7 дней. Пробелы — замеров не было."
      : "Расход от 0 до 100% за последние 7 дней. Пробелы — замеров не было.");
  if (chart.hidden) {
    chart.replaceChildren();
    return;
  }
  const start = history[0].time;
  const end = history.at(-1).time;
  const svg = svgNode("svg", { viewBox: "0 0 312 80", role: "img", "aria-label": t(settings.showRemaining ? "График остатка лимитов" : "График расхода лимитов") });
  for (const y of [3, 40, 77]) {
    svg.append(svgNode("line", { class: "chart-grid", x1: 0, x2: 312, y1: y, y2: y }));
  }

  const axis = document.createElement("div");
  axis.className = "axis";
  for (const time of [start, end]) {
    const label = document.createElement("span");
    label.textContent = resetDate.format(time);
    axis.append(label);
  }

  const legend = document.createElement("div");
  legend.className = "legend";
  windows.forEach(({ label }, index) => {
    const group = svgNode("g", { class: "series-" + index });
    const path = [];
    let previous = null;
    for (const point of history) {
      const used = point.used[index];
      if (used === null) {
        previous = null;
        continue;
      }
      const x = 2 + (point.time - start) / (end - start) * 308;
      const y = 77 - displayPercent(used, settings.showRemaining) * 0.74;
      const connected = previous && point.time - previous < 35 * 60_000;
      path.push((connected ? "L" : "M") + x.toFixed(2) + "," + y.toFixed(2));
      if (!connected) group.append(svgNode("circle", { cx: x, cy: y, r: 2, fill: "currentColor" }));
      previous = point.time;
    }
    group.append(svgNode("path", { d: path.join(" "), stroke: "currentColor", "stroke-width": 2, fill: "none" }));
    svg.append(group);

    const key = document.createElement("span");
    key.className = "series-" + index;
    key.textContent = ["━ ", "┅ ", "┈ "][index] + t(label);
    legend.append(key);
  });
  chart.replaceChildren(svg, axis, legend);
}

function drawActivity(history) {
  const days = observedUsage(history);
  const activity = $("activity");
  activity.hidden = days.every(({ total }) => total === null);
  if (activity.hidden) return;

  const maximum = Math.max(...days.flatMap(({ hours }) => hours));
  const table = document.createElement("table");
  table.setAttribute("aria-label", t("Наблюдаемый расход месячного лимита по часам и дням"));
  const heading = table.createTHead().insertRow();
  for (const label of [t("Дата"), ...Array.from({ length: 24 }, (_, hour) => hour), t("День")]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    if (typeof label === "number" && label % 6 !== 0) cell.className = "quiet-hour";
    heading.append(cell);
  }

  const body = table.createTBody();
  for (const day of days) {
    const row = body.insertRow();
    const date = document.createElement("th");
    date.scope = "row";
    date.textContent = dayLabel.format(day.time);
    row.append(date);
    for (const [hour, value] of day.hours.entries()) {
      const cell = row.insertCell();
      cell.className = "hour";
      const label = value === null ? t("Нет замера") : decimal.format(value) + " " + t("п. п.");
      cell.title = date.textContent + " · " + hour + ":00 · " + label;
      cell.setAttribute("aria-label", label);
      if (value === null) cell.classList.add("missing");
      else if (value > 0) cell.style.setProperty("--intensity", Math.max(24, value / maximum * 100) + "%");
    }
    row.insertCell().textContent = day.total === null ? "—" : decimal.format(day.total);
  }
  $("heatmap").replaceChildren(table);
}

function describeError(error) {
  switch (error?.code) {
    case "login": return t("Войдите в OpenCode Console в этом профиле Chrome.");
    case "subscription": return t("В этом пространстве нет активного лимита OpenCode Go.");
    case "format": return t("OpenCode вернул данные в неожиданном формате.");
    case "http": return t("OpenCode вернул ошибку HTTP") + " " + error.status + ".";
    case "network": return t("Нет соединения с OpenCode. Попробуйте обновить.");
    default: return t("Запрашиваем лимиты…");
  }
}

function draw() {
  const { snapshot, error, workspaces = [], workspaceId, history = [] } = state;
  const stale = snapshot && (error || Date.now() - snapshot.time >= staleAfter(settings.refreshMinutes));
  const updated = snapshot ? clock.format(snapshot.time) : "";
  let text = snapshot ? t("Обновлено") + " " + updated : describeError(error);
  if (stale) text = (error ? describeError(error) : t("Данные устарели.")) + " " + t("Показан замер за") + " " + updated + ".";
  status.textContent = busy && !snapshot ? t("Запрашиваем лимиты…") : text;
  status.toggleAttribute("data-error", Boolean(!busy && (stale || error)));

  $("signin").hidden = error?.code !== "login";
  $("workspace-picker").hidden = workspaces.length < 2;
  const options = workspaces.map(({ id, name }) => new Option(name, id));
  if (options.length && !options.some(({ value }) => value === workspaceId)) {
    options.unshift(new Option(t("Выберите пространство"), "", true, true));
    options[0].disabled = true;
  }
  workspace.replaceChildren(...options);
  workspace.value = workspaceId || "";
  $("console").href = workspaceId ? ORIGIN + "/console/" + encodeURIComponent(workspaceId) + "/go" : ORIGIN + "/console";

  $("quota-heading").textContent = t(settings.showRemaining ? "Остаток лимита" : "Израсходовано");
  $("badge-caption").textContent = t(settings.showRemaining ? "На значке — остаток за 5 ч" : "На значке — расход за 5 ч");
  $("quota").hidden = $("history").hidden = !snapshot;
  if (snapshot) {
    drawMeters(snapshot.windows);
    if ($("history").open) {
      drawHistory(history, snapshot.windows);
      drawActivity(history);
    }
  }
}

async function send(message) {
  if (busy) return false;
  busy = refresh.disabled = workspace.disabled = true;
  draw();
  try {
    if (await chrome.runtime.sendMessage(message)) return true;
    throw new Error();
  } catch {
    state = { ...state, error: { code: "network" } };
    return false;
  } finally {
    busy = refresh.disabled = workspace.disabled = false;
    draw();
  }
}

$("history").addEventListener("toggle", () => {
  if ($("history").open) draw();
});
refresh.addEventListener("click", () => send({ type: "refresh", force: true }));
workspace.addEventListener("change", () => send({ type: "workspace", id: workspace.value }));
function showSettings(open) {
  $("dashboard").hidden = open;
  $("settings-panel").hidden = !open;
  $(open ? "close-settings" : "open-settings").focus();
  if (open) {
    chrome.notifications.getPermissionLevel().then((permission) => {
      notificationPermission = permission;
      drawNotificationStatus();
    }).catch(() => {});
  }
}

$("open-settings").addEventListener("click", () => showSettings(true));
$("close-settings").addEventListener("click", () => showSettings(false));
systemTheme.addEventListener("change", applyTheme);

form.addEventListener("submit", (event) => event.preventDefault());
form.addEventListener("change", async ({ target }) => {
  let value = target.value;
  if (target.name === "thresholds") value = thresholdInputs.filter((input) => input.checked).map((input) => Number(input.value));
  else if (target.type === "checkbox") value = target.checked;
  else if (target.name === "refreshMinutes") value = Number(value);

  $("settings-error").hidden = true;
  try {
    if (await chrome.runtime.sendMessage({ type: "settings", values: { [target.name]: value } })) return;
  } catch {
    // Storage events update controls after a successful save.
  }
  const stored = await chrome.storage.local.get("settings");
  applySettings(stored.settings);
  $("settings-error").hidden = false;
});

testNotification.addEventListener("click", async () => {
  testingNotification = true;
  drawNotificationStatus();
  notificationResult = await chrome.runtime.sendMessage({ type: "test-notification" }).catch(() => false);
  testingNotification = false;
  drawNotificationStatus();
});

const stored = await chrome.storage.local.get(["state", "settings"]);
state = stored.state ?? {};
applySettings(stored.settings);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.state) state = changes.state.newValue ?? {};
  if (changes.settings) applySettings(changes.settings.newValue);
  else draw();
});
send({ type: "refresh" });
setInterval(() => {
  if (state.snapshot) {
    drawMeters(state.snapshot.windows);
    if (Date.now() - state.snapshot.time >= staleAfter(settings.refreshMinutes) && !state.error) draw();
  }
}, 30_000);
