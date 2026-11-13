// 人物メモの画面のURLを作る（specs/people/001-people-memo contracts/ui-routes.md 1）。URLの頭（/people）と形はここだけに書く。

/** 人物メモの画面のURLの頭。 */
export const PEOPLE_BASE = "/people";

/**
 * 誘う候補（ホーム）。
 * @returns URL
 */
export function peopleHomePath(): string {
  return PEOPLE_BASE;
}

/**
 * 取り込み。
 * @returns URL
 */
export function importPath(): string {
  return `${PEOPLE_BASE}/import`;
}

/**
 * イベントの一覧。
 * @returns URL
 */
export function eventsPath(): string {
  return `${PEOPLE_BASE}/events`;
}

/**
 * イベントを作る。
 * @returns URL
 */
export function newEventPath(): string {
  return `${PEOPLE_BASE}/events/new`;
}

/**
 * イベントのページ。
 * @param eventId - イベントのID
 * @returns URL
 */
export function eventPath(eventId: string): string {
  return `${PEOPLE_BASE}/events/${encodeURIComponent(eventId)}`;
}

/**
 * 人の一覧。
 * @returns URL
 */
export function personsPath(): string {
  return `${PEOPLE_BASE}/list`;
}

/**
 * 人を手で足す。
 * @returns URL
 */
export function newPersonPath(): string {
  return `${PEOPLE_BASE}/list/new`;
}

/**
 * 人のページ。
 * @param personId - 人のID
 * @returns URL
 */
export function personPath(personId: string): string {
  return `${PEOPLE_BASE}/list/${encodeURIComponent(personId)}`;
}

/**
 * 誘いの文と目標（設定）。
 * @returns URL
 */
export function settingsPath(): string {
  return `${PEOPLE_BASE}/settings`;
}
