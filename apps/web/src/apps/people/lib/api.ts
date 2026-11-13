// 人物メモのAPIの呼び出し（specs/people/001-people-memo contracts/api.md）。道筋は /api/people/…。
// APIの基本のURL・認証のトークン・エラーの扱いは、共通の部品（lib/api-client.ts の request）を使う。
// 応答の形は @meguru/shared/people の型（応答の zod スキーマは共通にないので、型だけを当てる）。
import type {
  CandidateList,
  EventDeletePreview,
  ImportPreview,
  ImportResult,
  ImportUndoPreview,
  PeopleAttendee,
  PeopleEvent,
  PeopleEventDetail,
  PeopleEventListItem,
  PeopleFacets,
  PeopleMe,
  PersonConsent,
  PersonDetail,
  PersonList,
  PersonListQuery,
  PersonSummary,
  UndoResult,
  Consent,
  ConsentPurpose,
  ImportField,
  Outreach,
  OutreachPurpose,
  OutreachStage,
  PeopleSettings,
  PeopleStats,
} from "@meguru/shared/people";
import { z } from "zod";
import { request } from "@/lib/api-client";

/**
 * 応答を確かめずに、型だけを当てるスキーマ（応答の形は API と同じ共通の型で決めている）。
 * @returns zod のスキーマ
 */
const typed = <T>() => z.custom<T>(() => true);

/** イベントを作る・直すの入力。 */
export type EventInput = { name: string; heldOn: string; isOwn: boolean };

/** 取り込みのプレビューの入力（CSVの見出しと行は、メモリーにだけ置いたものを送る。research.md R18）。 */
export type ImportPreviewInput = {
  eventId: string;
  headers: string[];
  rows: string[][];
  columns?: (ImportField | null)[];
  consentChoices?: Record<string, ConsentPurpose>;
};

/** 行ごとの決め。 */
export type ImportDecision = { row: number; action: "new" | "link" | "skip"; personId?: string };

/** 取り込む（書く）の入力。 */
export type ImportCommitInput = Omit<ImportPreviewInput, "columns"> & { columns: (ImportField | null)[]; decisions: ImportDecision[] };

/** 人の一覧の探す言葉と絞り込み（省いた項目は絞らない）。 */
export type PersonListParams = Partial<PersonListQuery>;

/** 人を手で足すの入力（本名かLINE名のどちらかは必須）。 */
export type PersonCreateInput = { realName?: string; lineName?: string; eventId?: string; consent: Consent };

/** 人を直すの入力（本名の null は本名を消す。メモの空は null）。 */
export type PersonUpdateInput = { realName?: string | null; memoAppearance?: string | null; memoTalk?: string | null };

/** 誘う候補の目的・誘う会・前に来た・人の一覧と同じ絞り込み（eventId は誘う会。人は絞らない）。 */
export type CandidateParams = PersonListParams & { purpose: OutreachPurpose; visitedOwn?: boolean };

/** 声かけを始めるの入力（交流会への誘いは誘う会、仕事の相談先へのつなぎは相談先の名前）。 */
export type OutreachCreateInput = { personId: string; purpose: "invite"; eventId: string } | { personId: string; purpose: "work"; targetName: string };

/** 設定を直すの入力（省いた項目は変えない。型の null は初めの型、目標の null は目標なし）。 */
export type SettingsUpdateInput = Partial<PeopleSettings>;

/**
 * 人の一覧と同じ絞り込みを、クエリに足す（next・wanted・career はくり返す）。
 * @param sp - 足す先
 * @param params - 探す言葉と絞り込み
 */
function appendListParams(sp: URLSearchParams, params: PersonListParams): void {
  if (params.q && params.q.trim() !== "") sp.set("q", params.q.trim());
  if (params.eventId) sp.set("eventId", params.eventId);
  for (const v of params.next ?? []) sp.append("next", v);
  for (const v of params.wanted ?? []) sp.append("wanted", v);
  for (const v of params.career ?? []) sp.append("career", v);
  if (params.lastMetFrom) sp.set("lastMetFrom", params.lastMetFrom);
  if (params.lastMetTo) sp.set("lastMetTo", params.lastMetTo);
  if (params.offset) sp.set("offset", String(params.offset));
}

/**
 * クエリの文字にする。
 * @param sp - クエリ
 * @returns `?…`（何もなければ空）
 */
function toSearch(sp: URLSearchParams): string {
  const text = sp.toString();
  return text === "" ? "" : `?${text}`;
}

/**
 * 人の一覧のクエリの文字を作る（next・wanted・career はくり返す）。
 * @param params - 探す言葉と絞り込み
 * @returns `?…`（何もなければ空）
 */
export function personListSearch(params: PersonListParams): string {
  const sp = new URLSearchParams();
  appendListParams(sp, params);
  return toSearch(sp);
}

/**
 * 誘う候補のクエリの文字を作る。誘う会（eventId）は交流会への誘いのときだけ送る。
 * @param params - 目的・誘う会・前に来た・絞り込み
 * @returns `?…`
 */
export function candidateSearch(params: CandidateParams): string {
  const { purpose, visitedOwn, eventId, ...rest } = params;
  const sp = new URLSearchParams({ purpose });
  appendListParams(sp, { ...rest, ...(purpose === "invite" && eventId ? { eventId } : {}) });
  if (visitedOwn) sp.set("visitedOwn", "true");
  return toSearch(sp);
}

/**
 * JSON の本文つきの設定。
 * @param method - HTTP のメソッド
 * @param body - 本文
 * @returns fetch の設定
 */
const withBody = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

/**
 * イベントの道筋。
 * @param id - イベントのID
 * @returns 道筋
 */
const eventUrl = (id: string) => `/api/people/events/${encodeURIComponent(id)}`;

/**
 * 取り込みの道筋。
 * @param id - 取り込みのID
 * @returns 道筋
 */
const importUrl = (id: string) => `/api/people/imports/${encodeURIComponent(id)}`;

/**
 * 人の道筋。
 * @param id - 人のID
 * @returns 道筋
 */
const personUrl = (id: string) => `/api/people/persons/${encodeURIComponent(id)}`;

/**
 * 声かけの道筋。
 * @param id - 声かけのID
 * @returns 道筋
 */
const outreachUrl = (id: string) => `/api/people/outreaches/${encodeURIComponent(id)}`;

/** 人物メモのAPIの呼び出し。 */
export const peopleApi = {
  me: () => request("/api/people/me", typed<PeopleMe>()),
  // ---- イベント（contracts/api.md 2）----
  events: async () => (await request("/api/people/events", typed<{ events: PeopleEventListItem[] }>())).events,
  createEvent: async (input: EventInput) =>
    (await request("/api/people/events", typed<{ event: PeopleEvent }>(), withBody("POST", input))).event,
  event: (id: string) => request(eventUrl(id), typed<PeopleEventDetail>()),
  attendees: async (id: string) => (await request(`${eventUrl(id)}/attendees`, typed<{ attendees: PeopleAttendee[] }>())).attendees,
  updateEvent: async (id: string, input: Partial<EventInput>) =>
    (await request(eventUrl(id), typed<{ event: PeopleEvent }>(), withBody("PATCH", input))).event,
  eventDeletePreview: (id: string) => request(`${eventUrl(id)}/delete-preview`, typed<EventDeletePreview>()),
  deleteEvent: (id: string, keepPeopleWithNotes?: boolean) =>
    request(eventUrl(id), typed<UndoResult>(), withBody("DELETE", { keepPeopleWithNotes })),
  // ---- 取り込み（contracts/api.md 3）----
  previewImport: (input: ImportPreviewInput) => request("/api/people/imports/preview", typed<ImportPreview>(), withBody("POST", input)),
  commitImport: (input: ImportCommitInput) => request("/api/people/imports", typed<ImportResult>(), withBody("POST", input)),
  undoPreview: (importId: string) => request(`${importUrl(importId)}/undo-preview`, typed<ImportUndoPreview>()),
  undoImport: (importId: string, keepPeopleWithNotes?: boolean) =>
    request(importUrl(importId), typed<UndoResult>(), withBody("DELETE", { keepPeopleWithNotes })),
  // ---- 人（contracts/api.md 4）----
  persons: (params: PersonListParams) => request(`/api/people/persons${personListSearch(params)}`, typed<PersonList>()),
  facets: () => request("/api/people/facets", typed<PeopleFacets>()),
  person: (id: string) => request(personUrl(id), typed<PersonDetail>()),
  createPerson: async (input: PersonCreateInput) =>
    (await request("/api/people/persons", typed<{ person: PersonSummary }>(), withBody("POST", input))).person,
  updatePerson: async (id: string, input: PersonUpdateInput) =>
    (await request(personUrl(id), typed<{ person: PersonSummary }>(), withBody("PATCH", input))).person,
  updateConsent: async (id: string, consent: Consent) =>
    (await request(`${personUrl(id)}/consent`, typed<{ consent: PersonConsent }>(), withBody("PUT", consent))).consent,
  addAttendance: async (id: string, eventId: string) =>
    (await request(`${personUrl(id)}/attendances`, typed<{ person: PersonSummary }>(), withBody("POST", { eventId }))).person,
  removeAttendance: (id: string, eventId: string) =>
    request(`${personUrl(id)}/attendances/${encodeURIComponent(eventId)}`, null, { method: "DELETE" }),
  mergePerson: async (id: string, otherPersonId: string) =>
    (await request(`${personUrl(id)}/merge`, typed<{ person: PersonSummary }>(), withBody("POST", { otherPersonId }))).person,
  splitResponse: async (responseId: string) =>
    (await request(`/api/people/responses/${encodeURIComponent(responseId)}/split`, typed<{ person: PersonSummary }>(), { method: "POST" })).person,
  deletePerson: (id: string, confirmName: string) => request(personUrl(id), null, withBody("DELETE", { confirmName })),
  // ---- 誘う候補・声かけ（contracts/api.md 5）----
  candidates: (params: CandidateParams) => request(`/api/people/candidates${candidateSearch(params)}`, typed<CandidateList>()),
  createOutreach: async (input: OutreachCreateInput) =>
    (await request("/api/people/outreaches", typed<{ outreach: Outreach }>(), withBody("POST", input))).outreach,
  updateOutreach: async (id: string, stage: OutreachStage) =>
    (await request(outreachUrl(id), typed<{ outreach: Outreach }>(), withBody("PATCH", { stage }))).outreach,
  deleteOutreach: (id: string) => request(outreachUrl(id), null, { method: "DELETE" }),
  // ---- 設定・数字（contracts/api.md 6）----
  settings: () => request("/api/people/settings", typed<PeopleSettings>()),
  updateSettings: (input: SettingsUpdateInput) => request("/api/people/settings", typed<PeopleSettings>(), withBody("PUT", input)),
  stats: () => request("/api/people/stats", typed<PeopleStats>()),
};
