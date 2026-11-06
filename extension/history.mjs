export const HISTORY_STEP = 15 * 60_000;
export const HISTORY_LENGTH = 7 * 24 * 60 * 60_000;

export function observedUsage(history, now = Date.now()) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + index - 6);
    return { time: date.getTime(), total: null, hours: Array(24).fill(null) };
  });
  const byDay = new Map(days.map((day) => [day.time, day]));
  for (let index = 1; index < history.length; index++) {
    const from = history[index - 1];
    const to = history[index];
    const previous = from.used[2];
    const current = to.used[2];
    if (!from.monthlyReset || from.monthlyReset !== to.monthlyReset || to.time >= to.monthlyReset ||
        to.time - from.time > 25 * 60_000 || !Number.isFinite(previous) || !Number.isFinite(current)) continue;

    const date = new Date(to.time);
    const hour = date.getHours();
    const day = byDay.get(date.setHours(0, 0, 0, 0));
    if (!day) continue;
    const change = Math.max(0, current - previous);
    day.total = (day.total ?? 0) + change;
    day.hours[hour] = (day.hours[hour] ?? 0) + change;
  }
  return days;
}
