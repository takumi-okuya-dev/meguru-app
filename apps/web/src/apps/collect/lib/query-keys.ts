// 集金管理の TanStack Query のキー。
/** 集金管理の TanStack Query のキー（アプリの中だけで使う。外枠のキーと混ぜない）。 */
export const collectQueryKeys = {
  all: ["collect"] as const,
  me: ["collect", "me"] as const,
  events: ["collect", "events"] as const,
  event: (eventId: string) => ["collect", "event", eventId] as const,
  roster: (eventId: string) => ["collect", "roster", eventId] as const,
  pastAttendees: (eventId: string, q: string) => ["collect", "past-attendees", eventId, q] as const,
  settings: ["collect", "settings"] as const,
  paypayQr: ["collect", "paypay-qr"] as const,
};
