import assert from "node:assert/strict";
import test from "node:test";
import { interfaceLanguage, normalizeSettings } from "../extension/settings.mjs";

test("сохраняет прежний флаг уведомлений и добавляет настройки по умолчанию", () => {
  assert.deepEqual(normalizeSettings({ notifications: true }), {
    language: "browser",
    theme: "system",
    notifications: true,
    thresholds: [75, 90, 100],
    showRemaining: false,
    refreshMinutes: 2,
  });
});

test("принимает выбранные пороги и интервал, игнорирует недопустимые значения", () => {
  const settings = normalizeSettings({
    language: "de", theme: "dark", thresholds: [90, 95, 90], showRemaining: true, refreshMinutes: 5,
  });
  assert.deepEqual(settings.thresholds, [90]);
  assert.equal(settings.language, "browser");
  assert.equal(settings.theme, "dark");
  assert.equal(settings.refreshMinutes, 5);
  assert.equal(settings.showRemaining, true);
  assert.deepEqual(normalizeSettings({ thresholds: [] }).thresholds, []);
});

test("поддерживает язык браузера и явный выбор языка", () => {
  assert.equal(interfaceLanguage("browser", "ru-RU"), "ru");
  assert.equal(interfaceLanguage("browser", "en-US"), "en");
  assert.equal(interfaceLanguage("ru", "en-US"), "ru");
});
