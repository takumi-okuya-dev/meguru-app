// 人物メモのTanStack Queryのキー（specs/people/001-people-memo contracts/api.md）。すべて ["people", …] の下に置く。

/** 人物メモのTanStack Queryのキー。 */
export const peopleQueryKeys = {
  all: ["people"] as const,
  // 人物メモの「自分」（/api/people/me）。退会の確かめでも読む（ダイアログを開くたびに読み直す）
  me: ["people", "me"] as const,
  withdrawalPreview: ["people", "me", "withdrawal-preview"] as const,
  events: ["people", "events"] as const,
  event: (id: string) => ["people", "events", id] as const,
  attendees: (id: string) => ["people", "events", id, "attendees"] as const,
  eventDeletePreview: (id: string) => ["people", "events", id, "delete-preview"] as const,
  undoPreview: (importId: string) => ["people", "imports", importId, "undo-preview"] as const,
};
