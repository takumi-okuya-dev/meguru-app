// 集金管理の画面のURLを作る（specs/collect/001-event-day-collection contracts/ui-routes.md 1）。URLの頭（/collect）と形はここだけに書く。
/** 集金管理の画面のURLの頭。 */
export const COLLECT_BASE = "/collect";

/**
 * イベントの一覧。
 * @returns URL
 */
export function eventsPath(): string {
  return COLLECT_BASE;
}

/**
 * イベントを作る画面。
 * @returns URL
 */
export function newEventPath(): string {
  return `${COLLECT_BASE}/events/new`;
}

/**
 * イベントを直す画面。
 * @param eventId - イベントの番号
 * @returns URL
 */
export function eventEditPath(eventId: string): string {
  return `${COLLECT_BASE}/events/${encodeURIComponent(eventId)}/edit`;
}

/**
 * 名簿の画面。
 * @param eventId - イベントの番号
 * @returns URL
 */
export function rosterPath(eventId: string): string {
  return `${COLLECT_BASE}/events/${encodeURIComponent(eventId)}/roster`;
}

/**
 * PayPay・振込先の設定の画面。
 * @returns URL
 */
export function collectSettingsPath(): string {
  return `${COLLECT_BASE}/settings`;
}

/**
 * 受付の画面（主催者）。
 * @param eventId - イベントの番号
 * @returns URL
 */
export function receptionPath(eventId: string): string {
  return `${COLLECT_BASE}/events/${encodeURIComponent(eventId)}/reception`;
}

/**
 * 受付の手伝いの画面（受付用リンク・受付をしている人）。
 * @param eventId - イベントの番号
 * @returns URL
 */
export function helpersPath(eventId: string): string {
  return `${COLLECT_BASE}/events/${encodeURIComponent(eventId)}/helpers`;
}

/** 手伝う人の受付の画面のルート（ログインなし）。 */
export const HELPER_RECEPTION_ROUTE = `${COLLECT_BASE}/r/:token`;
