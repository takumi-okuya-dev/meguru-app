// 集金管理の TanStack Query のキー。
/** 集金管理の TanStack Query のキー（アプリの中だけで使う。外枠のキーと混ぜない）。 */
export const collectQueryKeys = {
  all: ["collect"] as const,
  me: ["collect", "me"] as const,
  events: ["collect", "events"] as const,
  event: (eventId: string) => ["collect", "event", eventId] as const,
  roster: (eventId: string) => ["collect", "roster", eventId] as const,
  pastAttendees: (eventId: string, q: string) => ["collect", "past-attendees", eventId, q] as const,
  pastAttendeesOf: (eventId: string) => ["collect", "past-attendees", eventId] as const,
  settings: ["collect", "settings"] as const,
  paypayQr: ["collect", "paypay-qr"] as const,
  reception: (eventId: string) => ["collect", "reception", eventId] as const,
  link: (eventId: string) => ["collect", "link", eventId] as const,
  workers: (eventId: string) => ["collect", "workers", eventId] as const,
  helperInfo: (token: string) => ["collect", "helper", token, "info"] as const,
  helperReception: (token: string) => ["collect", "helper", token, "reception"] as const,
  helperPaypayQr: (token: string) => ["collect", "helper", token, "paypay-qr"] as const,
};
