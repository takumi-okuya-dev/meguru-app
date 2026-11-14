// 集金管理のAPIの呼び出し（specs/collect/001-event-day-collection contracts/api.md 1〜7）。道筋は /api/collect/…。
// 手伝う人（ログインなし）の呼び出しは helper-api.ts。003 の分配（specs/collect/003-revenue-sharing contracts/api.md）もここ。
// APIの基本のURL・認証のトークン・エラーの扱いは、共通の部品（lib/api-client.ts の request・requestBlob・requestFile）を使う。
import {
  addRosterPersonResponseSchema,
  memberSharingViewSchema,
  referralListSchema,
  referrerSuggestionsSchema,
  sharedEventListSchema,
  sharingInviteAcceptedSchema,
  sharingInviteCreatedSchema,
  sharingInviteInfoSchema,
  sharingSnapshotSchema,
  type CreateExpenseRequest,
  type CreateSharingMemberRequest,
  type UpdateExpenseRequest,
  type UpdateSharingMemberRequest,
  bulkAddRosterResponseSchema,
  collectEventListSchema,
  collectEventSchema,
  collectMeSchema,
  closeResponseSchema,
  closingSnapshotSchema,
  collectSettingsSchema,
  deleteEventResponseSchema,
  eventSummaryListSchema,
  liveTicketResponseSchema,
  transferItemSchema,
  threadsCandidateListSchema,
  transferListSchema,
  type PutSettlementRequest,
  pastAttendeesResponseSchema,
  receptionLinkResponseSchema,
  receptionSnapshotSchema,
  receptionWorkersResponseSchema,
  recordReceptionResponseSchema,
  resolveSelfRequestResponseSchema,
  versionResponseSchema,
  walkInResponseSchema,
  type ConfirmReceptionRequest,
  type RecordReceptionRequest,
  type SelfRequestAction,
  type WalkInRequest,
  rosterListSchema,
  rosterPersonSchema,
  type CollectMedia,
  type CollectMethod,
} from "@meguru/shared";
import { z } from "zod";
import { request, requestBlob, requestFile } from "@/lib/api-client";

/** イベントを作る・直すときの入力（画面の値）。 */
export type EventInput = {
  name: string;
  startsAt: string;
  endsAt: string | null;
  venue: string | null;
  capacity: number | null;
  methods: CollectMethod[];
  tiers: { id?: string; name: string; amount: number }[];
  /** Threads の候補から作るときの、元の宣伝内容の番号（作るときだけ） */
  sourceThreadsPromotionId?: string | null;
};

/** 名簿の人を足す・直すときの入力。 */
export type PersonInput = { name: string; kana?: string | null; media: CollectMedia; priceTierId: string; memo?: string | null; referrer?: string | null };

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const ev = (eventId: string) => `/api/collect/events/${encodeURIComponent(eventId)}`;

/** 集金管理のAPI。 */
export const collectApi = {
  me: () => request("/api/collect/me", collectMeSchema),
  // ---- イベント ----
  events: () => request("/api/collect/events", collectEventListSchema),
  event: (eventId: string) => request(ev(eventId), collectEventSchema),
  createEvent: (input: EventInput) => request("/api/collect/events", collectEventSchema, json("POST", input)),
  updateEvent: (eventId: string, input: Partial<EventInput>) => request(ev(eventId), collectEventSchema, json("PATCH", input)),
  // ---- 名簿 ----
  roster: (eventId: string) => request(`${ev(eventId)}/roster`, rosterListSchema),
  addPerson: (eventId: string, input: PersonInput) => request(`${ev(eventId)}/roster`, addRosterPersonResponseSchema, json("POST", input)),
  addPeopleBulk: (eventId: string, input: { names: string[]; media: CollectMedia; priceTierId: string; referrer?: string | null }) =>
    request(`${ev(eventId)}/roster/bulk`, bulkAddRosterResponseSchema, json("POST", input)),
  updatePerson: (eventId: string, personId: string, input: Partial<PersonInput>) =>
    request(`${ev(eventId)}/roster/${encodeURIComponent(personId)}`, z.object({ person: rosterPersonSchema, version: z.number() }), json("PATCH", input)),
  deletePerson: (eventId: string, personId: string) =>
    request(`${ev(eventId)}/roster/${encodeURIComponent(personId)}`, z.object({ version: z.number() }), { method: "DELETE" }),
  pastAttendees: (eventId: string, q: string) =>
    request(`/api/collect/past-attendees?${new URLSearchParams({ eventId, q })}`, pastAttendeesResponseSchema),
  // ---- 既定値 ----
  settings: () => request("/api/collect/settings", collectSettingsSchema),
  saveBankText: (bankText: string | null) => request("/api/collect/settings", collectSettingsSchema, json("PUT", { bankText })),
  uploadPaypayQr: (image: Blob) =>
    request("/api/collect/settings/paypay-qr", collectSettingsSchema, { method: "PUT", body: image, headers: { "Content-Type": image.type } }),
  paypayQr: () => requestBlob("/api/collect/settings/paypay-qr"),
  deletePaypayQr: () => request("/api/collect/settings/paypay-qr", collectSettingsSchema, { method: "DELETE" }),
  // ---- 受付（主催者） ----
  reception: (eventId: string) => request(`${ev(eventId)}/reception`, receptionSnapshotSchema),
  record: (eventId: string, personId: string, input: RecordReceptionRequest) =>
    request(`${ev(eventId)}/reception/${encodeURIComponent(personId)}`, recordReceptionResponseSchema, json("PUT", input)),
  undo: (eventId: string, personId: string) =>
    request(`${ev(eventId)}/reception/${encodeURIComponent(personId)}`, versionResponseSchema, { method: "DELETE" }),
  walkIn: (eventId: string, input: WalkInRequest) => request(`${ev(eventId)}/walk-ins`, walkInResponseSchema, json("POST", input)),
  liveTicket: (eventId: string) => request(`${ev(eventId)}/live-ticket`, liveTicketResponseSchema, { method: "POST" }),
  // ---- 受付の手伝い（主催者） ----
  link: (eventId: string) => request(`${ev(eventId)}/link`, receptionLinkResponseSchema),
  createLink: (eventId: string, expiresAt?: string) =>
    request(`${ev(eventId)}/link`, receptionLinkResponseSchema, json("POST", expiresAt ? { expiresAt } : {})),
  updateLink: (eventId: string, expiresAt: string) => request(`${ev(eventId)}/link`, receptionLinkResponseSchema, json("PATCH", { expiresAt })),
  stopLink: (eventId: string) => request(`${ev(eventId)}/link/stop`, receptionLinkResponseSchema, { method: "POST" }),
  // セルフ受付（specs/collect/002 contracts/api.md）
  selfLink: (eventId: string) => request(`${ev(eventId)}/self-link`, receptionLinkResponseSchema),
  createSelfLink: (eventId: string) => request(`${ev(eventId)}/self-link`, receptionLinkResponseSchema, json("POST", {})),
  updateSelfLink: (eventId: string, expiresAt: string) => request(`${ev(eventId)}/self-link`, receptionLinkResponseSchema, json("PATCH", { expiresAt })),
  stopSelfLink: (eventId: string) => request(`${ev(eventId)}/self-link/stop`, receptionLinkResponseSchema, { method: "POST" }),
  confirm: (eventId: string, personId: string, input: ConfirmReceptionRequest) =>
    request(`${ev(eventId)}/reception/${encodeURIComponent(personId)}/confirm`, recordReceptionResponseSchema, json("POST", input)),
  resolveRequest: (eventId: string, requestId: string, action: SelfRequestAction, personId?: string) =>
    request(
      `${ev(eventId)}/self-requests/${encodeURIComponent(requestId)}/${action}`,
      resolveSelfRequestResponseSchema,
      json("POST", personId ? { personId } : {}),
    ),
  workers: (eventId: string) => request(`${ev(eventId)}/helpers`, receptionWorkersResponseSchema),
  // ---- 締め ----
  closing: (eventId: string) => request(`${ev(eventId)}/closing`, closingSnapshotSchema),
  settle: (eventId: string, receiverKey: string, input: PutSettlementRequest) =>
    request(`${ev(eventId)}/settlements/${encodeURIComponent(receiverKey)}`, closingSnapshotSchema, json("PUT", input)),
  checkPaypay: (eventId: string) => request(`${ev(eventId)}/paypay-check`, closingSnapshotSchema, { method: "POST" }),
  close: (eventId: string) => request(`${ev(eventId)}/close`, closeResponseSchema, { method: "POST" }),
  // CSV（ファイル名は API の Content-Disposition のもの）
  exportCsv: (eventId: string) => requestFile(`${ev(eventId)}/export.csv`),
  // ---- 振込待ち ----
  transfers: (q: string) => request(`/api/collect/transfers${q ? `?${new URLSearchParams({ q })}` : ""}`, transferListSchema),
  confirmTransfer: (personId: string) => request(`/api/collect/transfers/${encodeURIComponent(personId)}/confirm`, transferItemSchema, { method: "POST" }),
  unconfirmTransfer: (personId: string) => request(`/api/collect/transfers/${encodeURIComponent(personId)}/confirm`, transferItemSchema, { method: "DELETE" }),
  // ---- 消す・まとめ ----
  deleteEvent: (eventId: string) => request(ev(eventId), deleteEventResponseSchema, { method: "DELETE" }),
  summaries: () => request("/api/collect/summaries", eventSummaryListSchema),
  // ---- Threads のイベントの候補 ----
  threadsCandidates: () => request("/api/collect/threads-candidates", threadsCandidateListSchema),
  deleteSummary: (summaryId: string) => request(`/api/collect/summaries/${encodeURIComponent(summaryId)}`, null, { method: "DELETE" }),
  // ---- 分配（specs/collect/003） ----
  sharing: (eventId: string) => request(`${ev(eventId)}/sharing`, sharingSnapshotSchema),
  addExpense: (eventId: string, input: CreateExpenseRequest) => request(`${ev(eventId)}/expenses`, sharingSnapshotSchema, json("POST", input)),
  updateExpense: (eventId: string, expenseId: string, input: UpdateExpenseRequest) =>
    request(`${ev(eventId)}/expenses/${encodeURIComponent(expenseId)}`, sharingSnapshotSchema, json("PATCH", input)),
  deleteExpense: (eventId: string, expenseId: string) => request(`${ev(eventId)}/expenses/${encodeURIComponent(expenseId)}`, sharingSnapshotSchema, { method: "DELETE" }),
  addMember: (eventId: string, input: CreateSharingMemberRequest) => request(`${ev(eventId)}/members`, sharingSnapshotSchema, json("POST", input)),
  updateMember: (eventId: string, memberId: string, input: UpdateSharingMemberRequest) =>
    request(`${ev(eventId)}/members/${encodeURIComponent(memberId)}`, sharingSnapshotSchema, json("PATCH", input)),
  deleteMember: (eventId: string, memberId: string) => request(`${ev(eventId)}/members/${encodeURIComponent(memberId)}`, sharingSnapshotSchema, { method: "DELETE" }),
  unlinkMember: (eventId: string, memberId: string) =>
    request(`${ev(eventId)}/members/${encodeURIComponent(memberId)}/link`, sharingSnapshotSchema, { method: "DELETE" }),
  createInvite: (eventId: string, memberId: string) =>
    request(`${ev(eventId)}/members/${encodeURIComponent(memberId)}/invite`, sharingInviteCreatedSchema, { method: "POST" }),
  stopInvite: (eventId: string, memberId: string) =>
    request(`${ev(eventId)}/members/${encodeURIComponent(memberId)}/invite`, sharingSnapshotSchema, { method: "DELETE" }),
  referrals: (eventId: string) => request(`${ev(eventId)}/referrals`, referralListSchema),
  referrers: () => request("/api/collect/referrers", referrerSuggestionsSchema),
  // ---- 招待を受ける人・つながった運営メンバー（集金管理の利用の許可はいらない） ----
  invite: (token: string) => request(`/api/collect/invites/${encodeURIComponent(token)}`, sharingInviteInfoSchema),
  acceptInvite: (token: string) => request(`/api/collect/invites/${encodeURIComponent(token)}/accept`, sharingInviteAcceptedSchema, { method: "POST" }),
  shares: () => request("/api/collect/shares", sharedEventListSchema),
  share: (eventId: string) => request(`/api/collect/shares/${encodeURIComponent(eventId)}`, memberSharingViewSchema),
};
