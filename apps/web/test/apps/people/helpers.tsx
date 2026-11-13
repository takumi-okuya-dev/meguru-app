// 人物メモの画面のテストの入れ物と見本（名前はすべて作ったもの）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type {
  CandidateItem,
  ImportColumn,
  ImportPreview,
  ImportPreviewRow,
  Outreach,
  PeopleEventListItem,
  PersonDetail,
  PersonListItem,
  PersonResponse,
  PersonSummary,
} from "@meguru/shared/people";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";

/**
 * ルートを、テスト用のクエリのクライアントの中で描く。
 * @param routes - ルート
 * @param path - 初めに開くURL
 * @returns ルーター
 */
export function renderRoutes(routes: RouteObject[], path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** イベントの見本。 */
export const EVENT_1011: PeopleEventListItem = { id: "e1", name: "10月11日 IT交流会", heldOn: "2026-10-11", isOwn: true, attendeeCount: 20, importCount: 1 };
/** ほかの人の会の見本。 */
export const EVENT_1125: PeopleEventListItem = { id: "e2", name: "11月25日 もくもく会", heldOn: "2026-11-25", isOwn: false, attendeeCount: 10, importCount: 1 };

/** これからの自分の会の見本（誘う会）。 */
export const EVENT_1213: PeopleEventListItem = { id: "e3", name: "IT交流会 12/13", heldOn: "2026-12-13", isOwn: true, attendeeCount: 0, importCount: 0 };

/** CSVの見出し。 */
export const HEADERS = ["タイムスタンプ", "LINE名を教えてください", "本名", "次回参加", "個別のご案内"];

/**
 * CSVの文字を作る。
 * @param rows - 行
 * @returns CSVの文字
 */
export function csvText(rows: string[][]): string {
  return [HEADERS, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\r\n");
}

/** 列の対応がすべて決まっているもの。 */
export const MAPPED_COLUMNS: ImportColumn[] = [
  { header: HEADERS[0]!, field: "submitted_at", source: "preset" },
  { header: HEADERS[1]!, field: "line_name", source: "remembered" },
  { header: HEADERS[2]!, field: "real_name", source: "remembered" },
  { header: HEADERS[3]!, field: "next_attendance", source: "preset" },
  { header: HEADERS[4]!, field: "contact_consent", source: "preset" },
];

/**
 * プレビューを作る（summary は行から数える）。
 * @param rows - 行の判定
 * @param over - 上書き
 * @returns プレビュー
 */
export function makePreview(rows: ImportPreviewRow[], over: Partial<ImportPreview> = {}): ImportPreview {
  const count = (s: ImportPreviewRow["status"]) => rows.filter((r) => r.status === s).length;
  return {
    columns: MAPPED_COLUMNS,
    mappingErrors: [],
    unknownConsentChoices: [],
    summary: {
      newCount: count("new"),
      candidateCount: count("candidate"),
      duplicateInFileCount: count("duplicate_in_file"),
      skippedCount: count("already_imported") + count("erased") + count("invalid"),
    },
    rows,
    ...over,
  };
}

/** 答えの見本。 */
export const ANSWERS = { nextAttendance: "参加したい", wantedConnections: ["エンジニア"], careerInterests: ["転職"] };

/**
 * 人の一覧の1行を作る。
 * @param over - 上書き
 * @returns 一覧の1行
 */
export function makeListItem(over: Partial<PersonListItem> = {}): PersonListItem {
  return {
    id: "p1",
    displayName: "山田はなこ",
    realName: "山田はなこ",
    lineName: "はな",
    lastMetOn: "2026-10-11",
    ownEventCount: 1,
    latestAnswers: ANSWERS,
    consent: { invite: true, work: false },
    ...over,
  };
}

/**
 * 人のページの回答を作る。
 * @param over - 上書き
 * @returns 回答
 */
export function makeResponse(over: Partial<PersonResponse> = {}): PersonResponse {
  return {
    id: "r1",
    submittedAt: "2026-10-11T10:00:00.000Z",
    lineName: "はな",
    realName: "山田はなこ",
    nextAttendance: "参加したい",
    bringFriends: null,
    wantedConnections: ["エンジニア"],
    careerInterests: ["転職"],
    consentChoices: [],
    answers: [
      { q: "LINE名を教えてください", a: "はな" },
      { q: "次回参加", a: "参加したい" },
      { q: "ひとこと", a: "" },
    ],
    ...over,
  };
}

/**
 * 人のページの頭を作る。
 * @param over - 上書き
 * @returns 人
 */
export function makeSummary(over: Partial<PersonSummary> = {}): PersonSummary {
  return {
    id: "p1",
    displayName: "山田はなこ",
    realName: "山田はなこ",
    lineName: "はな",
    otherLineNames: ["はなこ🌸"],
    memoAppearance: null,
    memoTalk: null,
    consent: { invite: true, work: false, source: "response", basisOn: "2026-10-11" },
    lastMetOn: "2026-11-25",
    ...over,
  };
}

/**
 * 人のページを作る（11月25日と10月11日に来て、回答が2つ）。
 * @param over - 上書き
 * @returns 人のページ
 */
export function makeDetail(over: Partial<PersonDetail> = {}): PersonDetail {
  return {
    person: makeSummary(),
    attendances: [
      { event: { id: "e2", name: EVENT_1125.name, heldOn: EVENT_1125.heldOn, isOwn: false }, via: "response", responses: [makeResponse({ id: "r2", lineName: "はなこ🌸", submittedAt: "2026-11-25T10:00:00.000Z" })] },
      { event: { id: "e1", name: EVENT_1011.name, heldOn: EVENT_1011.heldOn, isOwn: true }, via: "response", responses: [makeResponse()] },
    ],
    consentChanges: [{ invite: true, work: false, source: "response", basisOn: "2026-10-11", changedAt: "2026-10-12T03:00:00.000Z" }],
    outreaches: [],
    ...over,
  };
}

/**
 * 誘う候補の1行を作る。
 * @param over - 上書き
 * @returns 候補の1行
 */
export function makeCandidate(over: Partial<CandidateItem> = {}): CandidateItem {
  return { ...makeListItem(), outreach: null, ...over };
}

/**
 * 交流会への誘いの声かけを作る（12/13の会へ・興味を聞いた）。
 * @param over - 上書き
 * @returns 声かけ
 */
export function makeOutreach(over: Partial<Outreach> = {}): Outreach {
  return {
    id: "o1",
    personId: "p1",
    purpose: "invite",
    event: { id: EVENT_1213.id, name: EVENT_1213.name, heldOn: EVENT_1213.heldOn },
    targetName: null,
    stage: "asked",
    askedAt: "2026-11-20T03:00:00.000Z",
    linkSentAt: null,
    attendedAt: null,
    approvedAt: null,
    connectedAt: null,
    ...over,
  };
}
