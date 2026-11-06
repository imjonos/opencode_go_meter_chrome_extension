export const ORIGIN = "https://opencode.ai";
export const REFRESH_MINUTES = 2;
export function staleAfter(refreshMinutes) {
  return (refreshMinutes + 3) * 60_000;
}

const WINDOWS = [
  { id: "fiveHour", label: "5 часов" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
];
const percentages = {
  ru: new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }),
  en: new Intl.NumberFormat("en", { maximumFractionDigits: 1 }),
};

class QuotaError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) return number(Number(value));
  return null;
}

function timestamp(value) {
  const numeric = number(value);
  const time = numeric === null
    ? (typeof value === "string" ? Date.parse(value) : NaN)
    : numeric * (numeric < 1e12 ? 1000 : 1);
  return Number.isFinite(time) && time > 0 && time <= 8.64e15 ? time : null;
}

export function parseQuota(data) {
  if (data === null || data?.access === null) return null;
  const windows = WINDOWS.map(({ id, label }) => {
    const meter = data?.access?.meters?.[id];
    const used = number(meter?.usedMicroCents);
    const limit = number(meter?.limitMicroCents);
    return {
      id,
      label,
      used: used !== null && used >= 0 && limit > 0 ? Math.min(100, used / limit * 100) : null,
      resetsAt: timestamp(meter?.resetsAt) ?? (id === "month" ? timestamp(data?.access?.endsAt) : null),
    };
  });
  if (windows.every(({ used }) => used === null)) throw new QuotaError("format");
  return windows;
}

async function request(path, fetcher, signal, workspaceId) {
  const headers = { Accept: "application/json" };
  if (workspaceId) headers["x-org-id"] = workspaceId;
  const response = await fetcher(ORIGIN + "/console/api" + path, {
    credentials: "include",
    cache: "no-store",
    redirect: "manual",
    headers,
    signal,
  });
  if (response.status === 401 || response.type === "opaqueredirect") throw new QuotaError("login");
  if (!response.ok) throw new QuotaError("http", response.status);
  try {
    return await response.json();
  } catch {
    throw new QuotaError("format");
  }
}

export async function loadQuota(preferred, fetcher = fetch) {
  const signal = AbortSignal.timeout(15_000);
  const rows = await request("/orgs", fetcher, signal);
  if (!Array.isArray(rows)) throw new QuotaError("format");

  const workspaces = rows
    .filter((row) => typeof row?.id === "string" && /^(wrk|org)_[\w-]{1,100}$/.test(row.id))
    .map(({ id, name }) => ({ id, name: typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : id }));
  if (!workspaces.length && rows.length) throw new QuotaError("format");

  const read = async ({ id }) => ({
    workspaces,
    workspaceId: id,
    windows: parseQuota(await request("/go/status", fetcher, signal, id)),
  });
  const selected = workspaces.find(({ id }) => id === preferred);
  if (selected) return read(selected);
  if (!workspaces.length) return { workspaces, workspaceId: "", windows: null };

  const results = await Promise.allSettled(workspaces.map(read));
  const available = results.find((result) => result.status === "fulfilled" && result.value.windows);
  if (available) return available.value;
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  return results[0].value;
}

export function displayPercent(used, showRemaining) {
  return showRemaining ? 100 - used : used;
}

export function usageLabel(percent, language = "ru") {
  const format = percentages[language];
  if (percent > 0 && percent < 0.1) return "<" + format.format(0.1) + "%";
  if (percent < 100 && percent > 99.9) return ">" + format.format(99.9) + "%";
  return format.format(percent) + "%";
}

export function quotaTone(used) {
  if (used === null) return "muted";
  if (used >= 90) return "critical";
  if (used >= 75) return "warning";
  return "healthy";
}

export function toolbarState({ snapshot, error }, now = Date.now(), { refreshMinutes = REFRESH_MINUTES, showRemaining = false } = {}) {
  if (error || (snapshot && now - snapshot.time >= staleAfter(refreshMinutes))) return { badge: "!", tone: "muted" };
  if (!snapshot) return { badge: "—", tone: "muted" };
  const window = snapshot.windows.find(({ id }) => id === "fiveHour");
  if (window?.used == null) return { badge: "—", tone: "muted" };
  const percent = displayPercent(window.used, showRemaining);
  const rounded = percent === 100 ? 100 : Math.min(99, Math.round(percent));
  return { badge: String(rounded), tone: quotaTone(window.used), window };
}
