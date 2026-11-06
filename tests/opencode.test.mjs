import assert from "node:assert/strict";
import test from "node:test";
import { loadQuota, parseQuota, usageLabel, toolbarState } from "../extension/opencode.mjs";

const reset = "2026-11-06T08:00:00Z";
const payload = {
  access: {
    endsAt: "2026-12-06T08:00:00Z",
    meters: {
      fiveHour: { usedMicroCents: "1", limitMicroCents: "200", resetsAt: reset },
      week: { usedMicroCents: "35", limitMicroCents: "100", resetsAt: reset },
      month: { usedMicroCents: "83", limitMicroCents: "100", resetsAt: null },
    },
  },
};

test("читает долю расхода и использует конец подписки для сброса месяца", () => {
  const windows = parseQuota(payload);
  assert.deepEqual(windows.map(({ used }) => used), [0.5, 35, 83]);
  assert.equal(windows[0].resetsAt, Date.parse(reset));
  assert.equal(windows[2].resetsAt, Date.parse(payload.access.endsAt));
});

test("отличает нулевой расход, отсутствующую квоту и неизвестный формат", () => {
  const windows = parseQuota({ access: { meters: {
    fiveHour: { usedMicroCents: "0", limitMicroCents: "12" },
    week: { usedMicroCents: null, limitMicroCents: "30" },
  } } });
  assert.deepEqual(windows.map(({ used }) => used), [0, null, null]);
  assert.equal(parseQuota({ access: null }), null);
  assert.throws(() => parseQuota({ access: { meters: {} } }), { code: "format" });
});

test("значок показывает расход за 5 часов и отделяет устаревшие данные", () => {
  const time = Date.parse("2026-11-06T07:00:00Z");
  const state = { snapshot: { time, windows: parseQuota(payload) } };
  assert.equal(toolbarState(state, time).badge, "1");
  assert.equal(toolbarState(state, time).window.label, "5 часов");
  assert.equal(toolbarState(state, time + 6 * 60_000).badge, "!");
  assert.equal(toolbarState(state, time + 6 * 60_000, { refreshMinutes: 10 }).badge, "1");
  const fiveHour = { id: "fiveHour", label: "5 часов" };
  for (const [used, badge] of [[0, "0"], [2.6, "3"], [11, "11"], [99.999, "99"], [100, "100"], [null, "—"]]) {
    const state = { snapshot: { time, windows: [{ ...fiveHour, used }] } };
    assert.equal(toolbarState(state, time).badge, badge);
  }
  assert.equal(usageLabel(0), "0%");
  assert.equal(usageLabel(11), "11%");
  assert.equal(usageLabel(0.001), "<0,1%");
  assert.equal(usageLabel(99.999), ">99,9%");
  assert.equal(usageLabel(100), "100%");
});

test("переключает значок на остаток пятичасового лимита", () => {
  const time = Date.parse("2026-11-06T07:00:00Z");
  const windows = parseQuota(payload);
  const state = { snapshot: { time, windows: [{ ...windows[0], used: 21 }, ...windows.slice(1)] } };
  assert.equal(toolbarState(state, time, { showRemaining: true }).badge, "79");
  assert.equal(toolbarState(state, time, { showRemaining: true }).tone, toolbarState(state, time).tone);
  assert.equal(toolbarState(state, time, { showRemaining: false }).badge, "21");
  assert.equal(toolbarState(state, time + 6 * 60_000, { showRemaining: true }).badge, "!");

  for (const [used, badge] of [[0, "100"], [100, "0"], [null, "—"]]) {
    const windows = [{ id: "fiveHour", used }];
    assert.equal(toolbarState({ snapshot: { time, windows } }, time, { showRemaining: true }).badge, badge);
  }
});

test("использует сессию Chrome и выбирает первое пространство с Go", async () => {
  const calls = [];
  const result = await loadQuota("", async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith("/orgs")) return Response.json([
      { id: "wrk_zen", name: "Zen" },
      { id: "org_go", name: "Go" },
    ]);
    return Response.json(options.headers["x-org-id"] === "org_go" ? payload : { access: null });
  });
  assert.equal(result.workspaceId, "org_go");
  assert.deepEqual(calls.map(([, options]) => options.headers["x-org-id"]), [undefined, "wrk_zen", "org_go"]);
  assert.ok(calls.every(([url, options]) =>
    url.startsWith("https://opencode.ai/console/api/") &&
    options.credentials === "include" && options.redirect === "manual"));
});

test("сохраняет выбранное пространство, включая пространство без подписки", async () => {
  const result = await loadQuota("wrk_zen", async (url, options) => {
    if (url.endsWith("/orgs")) return Response.json([{ id: "wrk_zen" }, { id: "org_go" }]);
    assert.equal(options.headers["x-org-id"], "wrk_zen");
    return Response.json({ access: null });
  });
  assert.equal(result.workspaceId, "wrk_zen");
  assert.equal(result.windows, null);
});

test("различает завершённую сессию и временную ошибку сервера", async () => {
  for (const [status, code] of [[401, "login"], [403, "http"], [500, "http"]]) {
    await assert.rejects(loadQuota("", async () => new Response(null, { status })), { code });
  }
});
