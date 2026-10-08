// パフォーマンスの画面（specs/006-performance-feedback contracts/ui-routes.md、FR-011〜FR-031）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, PerformanceItem, PerformancePage, PerformanceSummary } from "@threads-grower/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPerformance = vi.fn();
const updateFeedback = vi.fn();
const exportPerformance = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, getPerformance, updateFeedback, exportPerformance } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { PerformancePage: Page } = await import("@/pages/performance");

const account: AccountSummary = {
  id: "a1",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  plan: "auto-grower",
  connectionStatus: "connected",
  lastUsedAt: null,
};

const summary = (over: Partial<PerformanceSummary> = {}): PerformanceSummary => ({
  baseline: 49.5,
  baselineSampleCount: 30,
  judgeableCount: 30,
  baselineIsZero: false,
  lastFetchedAt: "2026-10-07T18:00:00.000Z",
  insightsDenied: false,
  needsReconnect: false,
  counts: { all: 37, good: 7, normal: 16, poor: 9, pending: 4 },
  ...over,
});

const base: PerformanceItem = {
  id: "x",
  body: "本文",
  publishedAt: "2026-09-25T10:01:00.000Z",
  threadsPermalink: "https://www.threads.com/@takumi/post/1",
  state: "confirmed",
  metrics: { views: 167, likes: 5, replies: 0, reposts: 0, quotes: 0, shares: null },
  lastFetchedAt: "2026-10-02T10:01:00.000Z",
  lastElapsedHours: 168,
  nextFetchAt: null,
  confirmAt: null,
  judgment: "good",
  ratio: 167 / 49.5,
  unmeasurableReason: null,
  feedback: null,
};

const item = (over: Partial<PerformanceItem>): PerformanceItem => ({ ...base, ...over });

const page = (items: PerformanceItem[], over: Partial<PerformanceSummary> = {}): PerformancePage => ({
  summary: summary(over),
  items,
  nextCursor: null,
});

/**
 * パフォーマンスの画面を描く。
 * @returns ルーター
 */
function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: <Outlet context={{ account }} />,
        children: [{ path: "performance", element: <Page /> }],
      },
    ],
    { initialEntries: ["/accounts/a1/performance"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  getPerformance.mockReset();
  updateFeedback.mockReset();
  exportPerformance.mockReset();
});

describe("US1：反応数と判定を見る", () => {
  it("基準値の欄・アイコンの意味・判定のバッジ（FR-012〜FR-014）", async () => {
    getPerformance.mockResolvedValue(
      page([
        item({ id: "g" }),
        item({ id: "p", judgment: "poor", ratio: 23 / 49.5, metrics: { ...base.metrics!, views: 23 } }),
        item({ id: "n", judgment: "normal", ratio: 64 / 49.5 }),
      ]),
    );
    renderPage();
    expect(await screen.findByText("49.5")).toBeInTheDocument();
    expect(screen.getByText(/確定した直近30件の閲覧数の中央値です/)).toBeInTheDocument();
    expect(screen.getByText("基準値の2倍以上")).toBeInTheDocument();
    expect(screen.getByText("基準値の半分以下")).toBeInTheDocument();
    expect(screen.getByTitle("伸びた（基準値の3.4倍）")).toBeInTheDocument();
    expect(screen.getByTitle("伸びなかった（基準値の0.5倍）")).toBeInTheDocument();
    expect(screen.getByTitle("いつも通り（基準値の1.3倍）")).toBeInTheDocument();
    expect(screen.getAllByText("×3.4").length).toBeGreaterThan(0);
    // 返らなかった数は「−」
    expect(within(screen.getByTestId("card-g")).getByText("−")).toBeInTheDocument();
    expect(screen.getAllByText(/反応数の最終更新 10\/8 3:00/).length).toBeGreaterThan(0);
  });

  it("確定待ち（値なし・値あり）・遅れて確定・計測できませんのカード（FR-016a・FR-017・FR-018）", async () => {
    getPerformance.mockResolvedValue(
      page([
        item({
          id: "fresh",
          state: "pending",
          metrics: null,
          judgment: null,
          ratio: null,
          nextFetchAt: "2026-10-08T12:00:00.000Z",
          confirmAt: "2026-10-14T12:00:00.000Z",
        }),
        item({ id: "upd", state: "updating", judgment: null, ratio: null, confirmAt: "2026-10-12T12:00:00.000Z" }),
        item({ id: "late", state: "late_confirmed", lastElapsedHours: 288 }),
        item({ id: "gone", state: "unmeasurable", metrics: null, judgment: null, ratio: null, threadsPermalink: null, unmeasurableReason: "not_found" }),
      ]),
    );
    renderPage();
    const fresh = await screen.findByTestId("card-fresh");
    expect(within(fresh).getByText(/反応数は 10\/8 21:00 ごろに取り込みます/)).toBeInTheDocument();
    expect(within(fresh).getByTitle("確定待ち（値が確定してから判定します）")).toBeInTheDocument();
    expect(within(screen.getByTestId("card-upd")).getByText(/暫定の値です。10\/12ごろ値が確定して判定します。/)).toBeInTheDocument();
    expect(within(screen.getByTestId("card-late")).getByText(/投稿から12日後に取り込んだ値です/)).toBeInTheDocument();
    const gone = screen.getByTestId("card-gone");
    expect(within(gone).getByText(/Threadsでこの投稿を見つけられないため/)).toBeInTheDocument();
    expect(within(gone).queryByRole("link", { name: /Threadsで開く/ })).toBeNull();
    expect(within(fresh).getByRole("link", { name: /Threadsで開く/ })).toBeInTheDocument();
  });

  it("確定5件未満・基準値0の案内（FR-009）", async () => {
    getPerformance.mockResolvedValueOnce(page([], { baseline: null, judgeableCount: 3, baselineSampleCount: 3 }));
    renderPage();
    expect(await screen.findByText("確定した投稿が5件たまると判定を始めます（いま3件）")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("基準値0なら判定できない案内", async () => {
    getPerformance.mockResolvedValueOnce(page([], { baseline: 0, baselineIsZero: true }));
    renderPage();
    expect(await screen.findByText("基準値が0のため判定できません")).toBeInTheDocument();
  });

  it("タブはアイコンと件数で、押すと絞り込む（FR-015）", async () => {
    getPerformance.mockResolvedValue(page([item({ id: "g" })]));
    renderPage();
    const tab = await screen.findByRole("tab", { name: "伸びた 7件" });
    expect(screen.getByRole("tab", { name: "伸びなかった 9件" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "確定待ち 4件" })).toBeInTheDocument();
    await userEvent.click(tab);
    await waitFor(() => expect(getPerformance).toHaveBeenCalledWith("a1", "good", undefined));
  });

  it("「さらに表示する」で続きを読む（FR-019）", async () => {
    getPerformance
      .mockResolvedValueOnce({ ...page([item({ id: "1" })]), nextCursor: "c1" })
      .mockResolvedValueOnce(page([item({ id: "2" })]));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "さらに表示する" }));
    expect(await screen.findByTestId("card-2")).toBeInTheDocument();
    expect(getPerformance).toHaveBeenLastCalledWith("a1", "all", "c1");
  });

  it("grower機能を使えなければ案内だけを出し、CSVのボタンを出さない（FR-031）", async () => {
    getPerformance.mockRejectedValue(new ApiError("GROWER_FEATURE_REQUIRED", 403));
    renderPage();
    expect(await screen.findByText("パフォーマンス分析は有料の契約で使えます")).toBeInTheDocument();
    expect(screen.getByText(/プランの変更は運営者にお問い合わせください/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CSVで書き出す/ })).toBeNull();
  });

  it("反応数を読む許可がなければ、案内と再接続を出す", async () => {
    getPerformance.mockResolvedValue(page([], { insightsDenied: true }));
    renderPage();
    expect(await screen.findByText(/反応数を読む許可がありません/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再接続" })).toBeInTheDocument();
  });
});

describe("US2：伸びなかった投稿の傾向メモ", () => {
  const poor = (id: string, over: Partial<PerformanceItem> = {}) =>
    item({
      id,
      judgment: "poor",
      ratio: 0.2,
      feedback: { memo: null, includeInPrompt: true, inNextPrompt: true },
      ...over,
    });

  it("低調のタブの説明と、メモの入力欄・切り替え・入るかどうかの説明（FR-021・FR-022）", async () => {
    getPerformance.mockResolvedValue(
      page([
        poor("a", { feedback: { memo: "前置きが長い", includeInPrompt: true, inNextPrompt: true } }),
        poor("b", { feedback: { memo: null, includeInPrompt: false, inNextPrompt: false } }),
        poor("c", { feedback: { memo: null, includeInPrompt: true, inNextPrompt: false } }),
      ]),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: "伸びなかった 9件" }));
    expect(await screen.findByText(/新しい順に5件まで/)).toBeInTheDocument();
    const a = await screen.findByTestId("card-a");
    expect(within(a).getByLabelText(/傾向メモ/)).toHaveValue("前置きが長い");
    expect(within(a).getByText("6/200")).toBeInTheDocument();
    expect(within(a).getByRole("checkbox", { name: "プロンプトに入れる" })).toBeChecked();
    expect(within(a).getByText("次のプロンプトに入ります")).toBeInTheDocument();
    expect(within(screen.getByTestId("card-b")).getByText("外しています。以降のプロンプトには入りません")).toBeInTheDocument();
    expect(within(screen.getByTestId("card-c")).getByText("新しい5件に入っていないため、今は入りません")).toBeInTheDocument();
  });

  it("メモは入力欄から離れたときに保存し（変わっていなければ呼ばない）、切り替えは押したときに保存する", async () => {
    getPerformance.mockResolvedValue(page([poor("a"), poor("b", { feedback: { memo: null, includeInPrompt: true, inNextPrompt: false } })]));
    updateFeedback.mockImplementation(async (_a: string, id: string, body: { memo?: string; includeInPrompt?: boolean }) => ({
      item: poor(id, { feedback: { memo: body.memo ?? null, includeInPrompt: body.includeInPrompt ?? true, inNextPrompt: id !== "a" } }),
      promptIds: ["b"],
    }));
    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: "伸びなかった 9件" }));
    const a = await screen.findByTestId("card-a");
    const memo = within(a).getByLabelText(/傾向メモ/);
    await userEvent.click(memo);
    await userEvent.tab();
    expect(updateFeedback).not.toHaveBeenCalled();
    await userEvent.type(memo, "結論が遅い");
    await userEvent.tab();
    await waitFor(() => expect(updateFeedback).toHaveBeenCalledWith("a1", "a", { memo: "結論が遅い" }));
    // 応答の promptIds で、ほかのカードの表示が変わる（繰り上がり）
    expect(await within(screen.getByTestId("card-b")).findByText("次のプロンプトに入ります")).toBeInTheDocument();

    await userEvent.click(within(a).getByRole("checkbox", { name: "プロンプトに入れる" }));
    await waitFor(() => expect(updateFeedback).toHaveBeenCalledWith("a1", "a", { includeInPrompt: false }));
  });

  it("保存に失敗したら案内を出し、入力を残す", async () => {
    getPerformance.mockResolvedValue(page([poor("a")]));
    updateFeedback.mockRejectedValue(new ApiError("INTERNAL_ERROR", 500));
    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: "伸びなかった 9件" }));
    const memo = within(await screen.findByTestId("card-a")).getByLabelText(/傾向メモ/);
    await userEvent.type(memo, "残したいメモ");
    await userEvent.tab();
    expect(await screen.findByText("保存できませんでした。もう一度お試しください")).toBeInTheDocument();
    expect(memo).toHaveValue("残したいメモ");
  });

  it("すべてのタブの低調の投稿に、メモの要約・「改善メモを開く」・次のプロンプトに入る印を出す（FR-023）", async () => {
    getPerformance.mockResolvedValue(
      page([
        poor("a", { feedback: { memo: "前置きが長い", includeInPrompt: true, inNextPrompt: true } }),
        poor("b", { feedback: { memo: null, includeInPrompt: true, inNextPrompt: false } }),
        poor("c", { feedback: { memo: null, includeInPrompt: false, inNextPrompt: false } }),
      ]),
    );
    const router = renderPage();
    const a = await screen.findByTestId("card-a");
    expect(within(a).getByText("傾向メモ：前置きが長い")).toBeInTheDocument();
    expect(within(a).getByText("次のプロンプトに入ります")).toBeInTheDocument();
    expect(within(screen.getByTestId("card-b")).getByText("傾向メモはまだありません")).toBeInTheDocument();
    expect(within(screen.getByTestId("card-c")).getByText("プロンプトから外しています")).toBeInTheDocument();
    await userEvent.click(within(a).getByRole("button", { name: "改善メモを開く" }));
    await waitFor(() => expect(router.state.location.search).toBe("?tab=poor"));
  });
});

describe("US3：CSVで書き出す", () => {
  const exportRow = {
    id: "d1",
    publishedAt: "2026-09-25T10:01:00.000Z",
    body: "本文",
    metrics: null,
    ratio: null,
    state: "pending",
    judgment: null,
    permalink: null,
    lastFetchedAt: null,
    lastElapsedMinutes: null,
    followersAtPost: null,
    h24: null,
    batchId: "b1",
    batchPosition: 0,
    batchCreatedAt: "2026-09-20T00:00:00.000Z",
    approvedAt: null,
    prioritized: null,
    carryover: null,
    bodyEdited: null,
    slotMinute: null,
    strategyUpdatedAt: null,
    promotionsChangedAt: null,
    researchChangedAt: null,
    coreRulesChangedAt: null,
  };

  it("メニューから選ぶと、続きがなくなるまで読み、CSVファイルを保存させる（FR-028〜FR-030）", async () => {
    getPerformance.mockResolvedValue(page([item({ id: "g" })]));
    exportPerformance
      .mockResolvedValueOnce({ rows: [exportRow], nextCursor: "c1", generatedAt: "2026-10-08T00:00:00.000Z" })
      .mockResolvedValueOnce({ rows: [{ ...exportRow, id: "d2" }], nextCursor: null, generatedAt: "2026-10-08T00:00:00.000Z" });
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:csv";
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /CSVで書き出す/ }));
    expect(await screen.findByText(/1投稿1行/)).toBeInTheDocument();
    expect(screen.getByText(/取り込み1回1行/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: /投稿ごと/ }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(exportPerformance).toHaveBeenNthCalledWith(1, "a1", "posts", undefined);
    expect(exportPerformance).toHaveBeenNthCalledWith(2, "a1", "posts", "c1");
    expect(downloads[0]).toMatch(/^threads-takumi-posts-\d{8}\.csv$/);
    const text = await blobs[0]!.text();
    expect(text.startsWith('"投稿ID","投稿した日時"')).toBe(true);
    expect(text.split("\r\n").filter((l) => l.startsWith('"d'))).toHaveLength(2);
  });

  it("書き出しに失敗したら案内を出す", async () => {
    const { toast } = await import("sonner");
    getPerformance.mockResolvedValue(page([item({ id: "g" })]));
    exportPerformance.mockRejectedValue(new ApiError("INTERNAL_ERROR", 500));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /CSVで書き出す/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /取り込みごと/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("書き出せませんでした。もう一度お試しください"));
  });
});
