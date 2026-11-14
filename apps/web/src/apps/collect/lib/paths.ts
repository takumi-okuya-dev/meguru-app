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

/**
 * セルフ受付の画面（主催者。QRを出す。specs/collect/002）。
 * @param eventId - イベントの番号
 * @returns URL
 */
export function selfCheckInPath(eventId: string): string {
  return `${COLLECT_BASE}/events/${encodeURIComponent(eventId)}/self`;
}

/** 参加者のセルフ受付の画面のルート（ログインなし。specs/collect/002）。 */
export const SELF_CHECK_IN_ROUTE = `${COLLECT_BASE}/s/:token`;

/** 手伝う人の受付の画面のルート（ログインなし）。 */
export const HELPER_RECEPTION_ROUTE = `${COLLECT_BASE}/r/:token`;

/**
 * 締めの画面。
 * @param eventId - イベントの番号
 * @returns URL
 */
export function closingPath(eventId: string): string {
  return `${COLLECT_BASE}/events/${encodeURIComponent(eventId)}/closing`;
}

/**
 * 振込待ち（すべてのイベント）。
 * @returns URL
 */
export function transfersPath(): string {
  return `${COLLECT_BASE}/transfers`;
}

/**
 * 消したイベントのまとめ。
 * @returns URL
 */
export function summariesPath(): string {
  return `${COLLECT_BASE}/summaries`;
}

/**
 * 分配の画面（主催者。specs/collect/003）。
 * @param eventId - イベントの番号
 * @returns URL
 */
export function sharingPath(eventId: string): string {
  return `${COLLECT_BASE}/events/${encodeURIComponent(eventId)}/sharing`;
}

/** 招待を受ける画面のルート（ログインなしで開ける。specs/collect/003 research.md R6）。 */
export const JOIN_ROUTE = `${COLLECT_BASE}/join/:token`;

/**
 * つながったイベントの一覧（運営メンバー）。
 * @returns URL
 */
export function sharesPath(): string {
  return `${COLLECT_BASE}/shares`;
}

/**
 * つながったイベントの分配（運営メンバー。読むだけ）。
 * @param eventId - イベントの番号
 * @returns URL
 */
export function sharePath(eventId: string): string {
  return `${COLLECT_BASE}/shares/${encodeURIComponent(eventId)}`;
}
