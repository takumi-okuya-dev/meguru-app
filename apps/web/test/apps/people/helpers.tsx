// 人物メモの画面のテストの入れ物と見本（名前はすべて作ったもの）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ImportColumn, ImportPreview, ImportPreviewRow, PeopleEventListItem } from "@meguru/shared/people";
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
