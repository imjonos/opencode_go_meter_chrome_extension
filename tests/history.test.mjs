import assert from "node:assert/strict";
import test from "node:test";
import { observedUsage } from "../extension/history.mjs";

test("считает прирост месячного расхода по времени замера и отмечает неизвестные часы", () => {
  const date = new Date(2026, 10, 6, 10);
  const time = date.getTime();
  const history = [
    { time, used: [0, 0, 10], monthlyReset: time + 86_400_000 },
    { time: time + 15 * 60_000, used: [0, 0, 12.5], monthlyReset: time + 86_400_000 },
    { time: time + 30 * 60_000, used: [0, 0, 12.5], monthlyReset: time + 86_400_000 },
    { time: time + 60 * 60_000, used: [0, 0, 40], monthlyReset: time + 86_400_000 },
    { time: time + 75 * 60_000, used: [0, 0, 1], monthlyReset: time + 2 * 86_400_000 },
    { time: time + 90 * 60_000, used: [0, 0, 2], monthlyReset: time + 2 * 86_400_000 },
  ];
  const day = observedUsage(history, time + 2 * 60 * 60_000).at(-1);
  assert.equal(day.total, 3.5);
  assert.deepEqual(day.hours.slice(9, 13), [null, 2.5, 1, null]);
});
