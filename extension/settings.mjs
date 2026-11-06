import { REFRESH_MINUTES } from "./opencode.mjs";

export const THRESHOLDS = [75, 90, 100];
export const REFRESH_OPTIONS = [1, 2, 5, 10, 15];

export function normalizeSettings(values = {}) {
  return {
    language: ["browser", "ru", "en"].includes(values.language) ? values.language : "browser",
    theme: ["system", "light", "dark"].includes(values.theme) ? values.theme : "system",
    notifications: values.notifications === true,
    thresholds: Array.isArray(values.thresholds)
      ? THRESHOLDS.filter((value) => values.thresholds.includes(value)) : [...THRESHOLDS],
    showRemaining: values.showRemaining === true,
    refreshMinutes: REFRESH_OPTIONS.includes(values.refreshMinutes) ? values.refreshMinutes : REFRESH_MINUTES,
  };
}

const english = {
  "5 часов": "5 hours",
  "Неделя": "Week",
  "Месяц": "Month",
  "Обновить лимиты": "Refresh limits",
  "Настройки": "Settings",
  "К лимитам": "Back to limits",
  "Пространство": "Workspace",
  "Выберите пространство": "Choose a workspace",
  "Запрашиваем лимиты…": "Fetching limits…",
  "Открыть OpenCode Console": "Open OpenCode Console",
  "Консоль": "Console",
  "Израсходовано": "Used",
  "Остаток лимита": "Remaining",
  "На значке — расход за 5 ч": "Badge shows 5-hour usage",
  "На значке — остаток за 5 ч": "Badge shows remaining 5-hour quota",
  "нет данных": "no data",
  "израсходовано": "used",
  "осталось": "remaining",
  "нет свежих данных": "no recent data",
  "откройте расширение": "open the extension",
  "Время сброса неизвестно": "Reset time unavailable",
  "Время сброса прошло · ждём обновления": "Reset time passed · awaiting refresh",
  "Сброс": "Resets",
  "через": "in",
  "дн.": "d",
  "ч": "h",
  "мин": "min",
  "История лимитов": "Limit history",
  "График появится после нескольких замеров.": "The chart will appear after a few readings.",
  "Расход от 0 до 100% за последние 7 дней. Пробелы — замеров не было.": "Usage from 0 to 100% over the last 7 days. Gaps indicate missing readings.",
  "Остаток от 0 до 100% за последние 7 дней. Пробелы — замеров не было.": "Remaining quota from 0 to 100% over the last 7 days. Gaps indicate missing readings.",
  "График расхода лимитов": "Limit usage chart",
  "График остатка лимитов": "Remaining quota chart",
  "Расход по дням и часам": "Usage by day and hour",
  "Оценка в п. п. месячного лимита по замерам. Штриховка означает пропуск.": "Estimated percentage points of the monthly limit. Hatching indicates missing readings.",
  "Наблюдаемый расход месячного лимита по часам и дням": "Observed monthly quota usage by hour and day",
  "Дата": "Date",
  "День": "Daily",
  "Нет замера": "No reading",
  "п. п.": "pp",
  "Войдите в OpenCode Console в этом профиле Chrome.": "Sign in to OpenCode Console in this Chrome profile.",
  "В этом пространстве нет активного лимита OpenCode Go.": "This workspace has no active OpenCode Go quota.",
  "OpenCode вернул данные в неожиданном формате.": "OpenCode returned an unexpected response format.",
  "OpenCode вернул ошибку HTTP": "OpenCode returned HTTP",
  "Нет соединения с OpenCode. Попробуйте обновить.": "Could not connect to OpenCode. Try refreshing.",
  "Данные устарели.": "The data is stale.",
  "Обновлено": "Updated",
  "Показан замер за": "Showing the reading from",
  "Язык": "Language",
  "Как в браузере": "Use browser language",
  "Язык браузера": "Browser language",
  "Применяется к интерфейсу и уведомлениям.": "Applies to the interface and notifications.",
  "Уведомления": "Notifications",
  "Уведомлять при заполнении лимитов": "Notify when usage reaches a threshold",
  "при": "at",
  "Проверить уведомление": "Send test notification",
  "Уведомления разрешены браузером.": "Browser notifications are allowed.",
  "Уведомления заблокированы браузером.": "Browser notifications are blocked.",
  "Тестовое уведомление отправлено.": "Test notification sent.",
  "Не удалось отправить тестовое уведомление.": "Could not send the test notification.",
  "Тест уведомлений": "Notification test",
  "Уведомления OpenCode Go Meter работают.": "OpenCode Go Meter notifications are working.",
  "лимит": "limit",
  "Отображение": "Display",
  "Показывать остаток вместо расхода": "Show remaining quota instead of usage",
  "Оформление": "Theme",
  "Как в системе": "Use system theme",
  "Светлое": "Light",
  "Тёмное": "Dark",
  "Обновление": "Refresh",
  "Интервал обновления": "Refresh interval",
  "Не удалось сохранить настройки.": "Could not save settings.",
};

export function interfaceLanguage(language, browserLanguage) {
  return language === "browser" ? (browserLanguage.toLowerCase().startsWith("ru") ? "ru" : "en") : language;
}

export function translator(language) {
  return (label) => language === "en" ? english[label] ?? label : label;
}

export function intervalLabel(minutes, language) {
  if (language === "en") return minutes === 1 ? "Every minute" : "Every " + minutes + " minutes";
  return minutes === 1 ? "Каждую минуту" : "Каждые " + minutes + (minutes === 2 ? " минуты" : " минут");
}
