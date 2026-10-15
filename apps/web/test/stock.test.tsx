// 投稿ストックの画面（specs/003-prompt-bulk-register US1〜US3、contracts/ui-routes.md「投稿ストックの画面」）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AccountSummary,
  DraftBatchResult,
  PostDraft,
  PostDraftList,
  PromptResponse,
} from "@threads-grower/shared";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_ACCESS, OWNER_ACCESS } from "./helpers/access";

const listPostDrafts = vi.fn();
const getPrompt = vi.fn();
const putPromptSettings = vi.fn();
const createDraftBatch = vi.fn();
const deleteDraftBatch = vi.fn();
const updatePostDraft = vi.fn();
const deletePostDrafts = vi.fn();
const reviewPostDrafts = vi.fn();
const listPublished = vi.fn();
const getAutoPost = vi.fn();
const dismissBlockedNotice = vi.fn();
const prioritizeDraft = vi.fn();
const accountAccess = vi.fn(async () => OWNER_ACCESS);
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      accountAccess,
      listPostDrafts,
      getPrompt,
      putPromptSettings,
      createDraftBatch,
      deleteDraftBatch,
      updatePostDraft,
      deletePostDrafts,
      reviewPostDrafts,
      listPublished,
      getAutoPost,
      dismissBlockedNotice,
      prioritizeDraft,
    },
  };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, warning: toastWarning, info: toastInfo, dismiss: vi.fn() },
}));

const { ApiError } = await import("@/lib/api-client");
const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { StockPage } = await import("@/pages/stock");

const account: AccountSummary = {
  id: "a1",
  name: "たくみ",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  connectionStatus: "connected",
  lastUsedAt: null,
  role: "owner" as const,
  ownerName: null,
};

const PROMPT = "以下の情報をもとに、Threadsに投稿する文章を30件作ってください。";

function promptResponse(
  overrides: Partial<PromptResponse["summary"]> = {},
  count = 30,
): PromptResponse {
  return {
    prompt: count === 30 ? PROMPT : `${count}件のプロンプト`,
    count,
    summary: {
      strategyFilledCount: 11,
      promotionCount: 1,
      referencePostCount: 3,
      recentDraftCount: 0,
      length: 100,
      coreRuleCount: 0,
      ngWordCount: 0,
      rejectedCount: 0,
      dailyPostCount: 0,
      poorPostCount: 0,
      ...overrides,
    },
  };
}

function draft(overrides: Partial<PostDraft> = {}): PostDraft {
  return {
    id: "d1",
    batchId: "b1",
    position: 0,
    body: "下書きの本文",
    status: "needs_review",
    version: 1,
    reviewedAt: null,
    rejectReasons: [],
    rejectNote: null,
    prioritizedAt: null,
    carryover: false,
    publishedAt: null,
    threadsMediaId: null,
    threadsPermalink: null,
    publishFailedAt: null,
    publishError: null,
    blockedAt: null,
    blockedReason: null,
    blockedWords: [],
    createdBy: null,
    editedBy: null,
    editedAt: null,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  };
}

function batchResult(
  drafts: PostDraft[],
  overrides: Partial<DraftBatchResult> = {},
): DraftBatchResult {
  return {
    batchId: "b1",
    draftCount: drafts.length,
    delimiterFound: true,
    overLimitCount: 0,
    drafts,
    ...overrides,
  };
}

function listResponse(
  overrides: {
    items?: PostDraft[];
    approved?: PostDraft[];
    rejected?: PostDraft[];
    ngWords?: PostDraftList["ngWords"];
    canGeneratePrompt?: boolean;
    promptPostCount?: number;
    publishFailed?: PostDraft[];
    schedule?: PostDraftList["schedule"];
    autoPost?: PostDraftList["autoPost"];
  } = {},
): PostDraftList {
  const { items = [], approved = [], rejected = [], ngWords = [], ...rest } = overrides;
  return {
    needsReview: items,
    approved,
    rejected,
    publishFailed: [],
    schedule: {},
    autoPost: { enabled: false, slotCount: 0, stoppedReason: null },
    counts: {
      needsReview: items.length,
      approved: approved.length,
      rejected: rejected.length,
      published: 0,
      publishFailed: 0,
    },
    limits: { needsReview: 500, approved: 500 },
    ngWords,
    canGeneratePrompt: true,
    promptPostCount: 30,
    promptPostCountVersion: 1,
    people: {},
    ...rest,
  };
}

function renderPage(path = "/accounts/a1/stock") {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: (
          <>
            <Link to="/accounts/a1">ホームへ</Link>
            <Link to="/accounts/a1/stock">投稿ストックへ</Link>
            <UnsavedChangesProvider>
              <Outlet context={{ account }} />
            </UnsavedChangesProvider>
          </>
        ),
        children: [
          { index: true, element: <p>ホームの中身</p> },
          { path: "strategy", element: <p>課題の中身</p> },
          { path: "stock", element: <StockPage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  for (const fn of [
    listPostDrafts,
    getPrompt,
    putPromptSettings,
    createDraftBatch,
    deleteDraftBatch,
    updatePostDraft,
    deletePostDrafts,
    reviewPostDrafts,
    listPublished,
    getAutoPost,
    dismissBlockedNotice,
  ]) {
    fn.mockReset();
  }
  toastSuccess.mockReset();
  toastError.mockReset();
  toastWarning.mockReset();
  listPostDrafts.mockResolvedValue(listResponse());
  listPublished.mockResolvedValue({ items: [], nextCursor: null });
  getAutoPost.mockResolvedValue({ autoPost: { enabled: false, slotCount: 0, stoppedReason: null }, next: null, approvedCount: 0, daysLeft: null, notices: [] });
  getPrompt.mockImplementation((_id: string, count?: number) =>
    Promise.resolve(promptResponse({}, count ?? 30)),
  );
});

describe("プロンプトのカード（US1）", () => {
  it("要約が出て、「コピー」で全文がクリップボードに渡り、トーストが出る", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderPage();
    expect(
      await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "コピー" }));
    expect(writeText).toHaveBeenCalledWith(PROMPT);
    expect(toastSuccess).toHaveBeenCalledWith(
      "コピーしました。ChatGPTやClaudeに貼り付けて送ってください",
    );
  });

  it("コピーの失敗：全文の欄が開いて全選択され、案内が出る（research.md R13）", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    renderPage();
    await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映");
    await user.click(screen.getByRole("button", { name: "コピー" }));
    expect(
      await screen.findByText(
        "自動でコピーできませんでした。選択された文字を手でコピーしてください",
      ),
    ).toBeInTheDocument();
    const area = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "プロンプトの全文" });
    await waitFor(() =>
      expect([area.selectionStart, area.selectionEnd]).toEqual([0, PROMPT.length]),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("「プロンプトを見る」で書き換えると、書き換えた内容をコピーする。「元に戻す」で元に戻る（FR-005）", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderPage();
    await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映");
    await user.click(screen.getByRole("button", { name: "プロンプトを見る" }));
    const area = screen.getByRole("textbox", { name: "プロンプトの全文" });
    expect(area).toHaveValue(PROMPT);
    await user.clear(area);
    await user.type(area, "書き換えた");
    await user.click(screen.getByRole("button", { name: "コピー" }));
    expect(writeText).toHaveBeenLastCalledWith("書き換えた");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(area).toHaveValue(PROMPT);
  });

  it("作る件数を変えると、0.5秒後に保存してその件数のプロンプトを取り直す（FR-004）", async () => {
    const user = userEvent.setup();
    putPromptSettings.mockResolvedValue({ postCount: 10, version: 2 });
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "作る件数" });
    expect(input).toHaveValue(30);
    await user.clear(input);
    await user.type(input, "10");
    await waitFor(() => expect(putPromptSettings).toHaveBeenCalledWith("a1", 10, 1), {
      timeout: 2000,
    });
    expect(putPromptSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getPrompt).toHaveBeenCalledWith("a1", 10));
  });

  it("担当の人は作る件数を変えるとその件数のプロンプトを取り直すが、保存はしない（設定はオーナーだけ。PR #14 のCodexレビュー）", async () => {
    accountAccess.mockResolvedValue(EDITOR_ACCESS);
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "作る件数" });
    await user.clear(input);
    await user.type(input, "10");
    await waitFor(() => expect(getPrompt).toHaveBeenCalledWith("a1", 10), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 700));
    expect(putPromptSettings).not.toHaveBeenCalled();
    accountAccess.mockResolvedValue(OWNER_ACCESS);
  });

  it("保存中に件数を変えても並行して保存せず、終わってから最新の件数を保存する（Codexレビュー）", async () => {
    const user = userEvent.setup();
    let resolveFirst: (v: { postCount: number; version: number }) => void = () => {};
    putPromptSettings.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
    putPromptSettings.mockImplementation(async (_id: string, n: number, v: number) => ({ postCount: n, version: v + 1 }));
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "作る件数" });
    await user.clear(input);
    await user.type(input, "10");
    await waitFor(() => expect(putPromptSettings).toHaveBeenCalledWith("a1", 10, 1), {
      timeout: 2000,
    });
    await user.clear(input);
    await user.type(input, "20");
    await waitFor(() => expect(getPrompt).toHaveBeenCalledWith("a1", 20), { timeout: 2000 });
    expect(putPromptSettings).toHaveBeenCalledTimes(1);
    act(() => resolveFirst({ postCount: 10, version: 2 }));
    await waitFor(() => expect(putPromptSettings).toHaveBeenCalledTimes(2));
    // 1回目の保存で上がった版で送る（specs/008 FR-007）
    expect(putPromptSettings).toHaveBeenLastCalledWith("a1", 20, 2);
  });

  it("件数の保存で先に他の人が保存していたら（409）、黙って上書きせず最新の件数に合わせて知らせる（specs/008 FR-007、PR #9 のCodexレビュー）", async () => {
    const user = userEvent.setup();
    putPromptSettings.mockRejectedValueOnce(
      new ApiError("STALE_UPDATE", 409, [], { postCount: 12, version: 3 }, { name: "田中 健" }),
    );
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "作る件数" });
    await user.clear(input);
    await user.type(input, "10");
    await waitFor(() => expect(input).toHaveValue(12), { timeout: 2000 });
    expect(toastInfo).toHaveBeenCalledWith("田中 健さんが先に保存しました。作る件数を最新の12件にしました");
    expect(putPromptSettings).toHaveBeenCalledTimes(1);
  });

  it("保存中に次の件数を入力していたら、競合（409）でもその入力を捨てず、最新の版で保存し直す（PR #9 のCodexレビュー4回目）", async () => {
    const user = userEvent.setup();
    let rejectFirst: (e: unknown) => void = () => {};
    putPromptSettings.mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)));
    putPromptSettings.mockImplementation(async (_id: string, n: number, v: number) => ({ postCount: n, version: v + 1 }));
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "作る件数" });
    await user.clear(input);
    await user.type(input, "10");
    await waitFor(() => expect(putPromptSettings).toHaveBeenCalledWith("a1", 10, 1), { timeout: 2000 });
    await user.clear(input);
    await user.type(input, "20");
    act(() => rejectFirst(new ApiError("STALE_UPDATE", 409, [], { postCount: 12, version: 3 }, { name: "田中 健" })));
    await waitFor(() => expect(putPromptSettings).toHaveBeenLastCalledWith("a1", 20, 3), { timeout: 2000 });
    expect(input).toHaveValue(20);
    expect(toastInfo).toHaveBeenCalledWith("田中 健さんが先に保存しました（12件）。入力した件数で保存し直します");
  });

  it("保存中に20へ変えて10へ戻しても、続けて入力したものとして扱い、競合の後に最新の版で保存し直す（PR #9 のCodexレビュー5回目）", async () => {
    const user = userEvent.setup();
    let rejectFirst: (e: unknown) => void = () => {};
    putPromptSettings.mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)));
    putPromptSettings.mockImplementation(async (_id: string, n: number, v: number) => ({ postCount: n, version: v + 1 }));
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "作る件数" });
    await user.clear(input);
    await user.type(input, "10");
    await waitFor(() => expect(putPromptSettings).toHaveBeenCalledWith("a1", 10, 1), { timeout: 2000 });
    await user.clear(input);
    await user.type(input, "20");
    await user.clear(input);
    await user.type(input, "10");
    act(() => rejectFirst(new ApiError("STALE_UPDATE", 409, [], { postCount: 12, version: 3 }, { name: "田中 健" })));
    await waitFor(() => expect(putPromptSettings).toHaveBeenLastCalledWith("a1", 10, 3), { timeout: 2000 });
    expect(input).toHaveValue(10);
  });

  it("件数の保存に失敗したら、案内と「もう一度保存」を出し、押すまで送り直さない（Codexレビュー）", async () => {
    const user = userEvent.setup();
    putPromptSettings.mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0));
    putPromptSettings.mockResolvedValueOnce({ postCount: 10, version: 2 });
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "作る件数" });
    await user.clear(input);
    await user.type(input, "10");
    const retry = await screen.findByRole("button", { name: "もう一度保存" }, { timeout: 2000 });
    expect(screen.getByText(/^作る件数（10件）：/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700));
    expect(putPromptSettings).toHaveBeenCalledTimes(1);
    await user.click(retry);
    await waitFor(() => expect(putPromptSettings).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "もう一度保存" })).not.toBeInTheDocument(),
    );
  });

  it("作る件数が範囲外なら保存しない", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "作る件数" });
    await user.clear(input);
    await user.type(input, "51");
    expect(await screen.findByText("1〜50の整数で入力してください")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700));
    expect(putPromptSettings).not.toHaveBeenCalled();
  });

  it("読むだけの表示：canGeneratePrompt が false なら案内に変わり、getPrompt を呼ばない（FR-024、specs/013）", async () => {
    listPostDrafts.mockResolvedValue(listResponse({ canGeneratePrompt: false }));
    renderPage();
    expect(await screen.findByText("今はAIプロンプトを作れません")).toBeInTheDocument();
    expect(screen.getByText(/このアカウントは今、読むだけです/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "コピー" })).not.toBeInTheDocument();
    expect(getPrompt).not.toHaveBeenCalled();
  });

  it("課題が0項目なら、要約の代わりに課題の画面への案内が出る（FR-006）", async () => {
    const user = userEvent.setup();
    getPrompt.mockResolvedValue(promptResponse({ strategyFilledCount: 0 }));
    const router = renderPage();
    expect(await screen.findByText("課題を入力すると、投稿の精度が上がります")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "課題を入力する" }));
    expect(router.state.location.pathname).toBe("/accounts/a1/strategy");
  });

  it("プロンプトの取得に失敗したら、カードの中に原因と「再読み込み」を出す", async () => {
    const user = userEvent.setup();
    getPrompt.mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0));
    renderPage();
    const retry = await screen.findByRole("button", { name: "再読み込み" });
    expect(screen.getByRole("heading", { name: "投稿ストック" })).toBeInTheDocument();
    await user.click(retry);
    expect(
      await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映"),
    ).toBeInTheDocument();
  });

  it("投稿ストックの画面を開くたびに、プロンプトを取り直す（FR-007）", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映");
    expect(getPrompt).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("link", { name: "ホームへ" }));
    await screen.findByText("ホームの中身");
    await user.click(screen.getByRole("link", { name: "投稿ストックへ" }));
    await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映");
    await waitFor(() => expect(getPrompt).toHaveBeenCalledTimes(2));
  });
});

describe("貼り付け欄（US2）", () => {
  const composer = () => screen.getByRole("textbox", { name: "AIの返信を貼り付ける欄" });
  const sendButton = () => screen.getByRole("button", { name: "投稿ストックに登録する" });

  async function paste(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.click(composer());
    await user.paste(text);
  }

  it("登録と取り消し：送ると案内が出て一覧に並び、「取り消す」で一覧から消えて欄に内容が戻る（FR-016・FR-016a）", async () => {
    const user = userEvent.setup();
    const drafts = [
      draft({ id: "d1", body: "1件目" }),
      draft({ id: "d2", position: 1, body: "2件目" }),
    ];
    createDraftBatch.mockImplementation(async () => {
      listPostDrafts.mockResolvedValue(listResponse({ items: drafts }));
      return batchResult(drafts);
    });
    deleteDraftBatch.mockImplementation(async () => {
      listPostDrafts.mockResolvedValue(listResponse());
      return { deletedCount: 2 };
    });
    renderPage();
    await screen.findByText(/まだ下書きがありません/);
    await paste(user, "1件目\n@@@\n2件目");
    await user.click(sendButton());
    expect(await screen.findByText("2件を登録しました")).toBeInTheDocument();
    expect(createDraftBatch).toHaveBeenCalledWith("a1", {
      clientRequestId: expect.any(String),
      text: "1件目\n@@@\n2件目",
    });
    expect(await screen.findByText("1件目")).toBeInTheDocument();
    expect(screen.getByText("2件目")).toBeInTheDocument();
    expect(composer()).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "取り消す" }));
    expect(deleteDraftBatch).toHaveBeenCalledWith("a1", "b1");
    await waitFor(() => expect(composer()).toHaveValue("1件目\n@@@\n2件目"));
    expect(toastSuccess).toHaveBeenCalledWith("2件の登録を取り消しました");
    expect(await screen.findByText(/まだ下書きがありません/)).toBeInTheDocument();
    expect(screen.queryByText("2件を登録しました")).not.toBeInTheDocument();
  });

  it("次の送信が失敗しても、前回の登録の案内（「取り消す」）は残る（Codexレビュー）", async () => {
    const user = userEvent.setup();
    createDraftBatch.mockResolvedValueOnce(batchResult([draft()]));
    createDraftBatch.mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0));
    renderPage();
    await screen.findByText(/まだ下書きがありません/);
    await paste(user, "1回目");
    await user.click(sendButton());
    await screen.findByText("1件を登録しました");
    await paste(user, "2回目");
    await user.click(sendButton());
    await screen.findByRole("button", { name: "もう一度送る" });
    expect(screen.getByText("1件を登録しました")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取り消す" })).toBeInTheDocument();
  });

  it("削除の確定を待っている間に送ると、先に削除を確定してから登録する（Codexレビュー）", async () => {
    const user = userEvent.setup();
    const items = [
      draft({ id: "d1", body: "1件目" }),
      draft({ id: "d2", position: 1, body: "2件目" }),
    ];
    listPostDrafts.mockResolvedValue({
      ...listResponse({ items }),
      limits: { needsReview: 2, approved: 500 },
    });
    deletePostDrafts.mockResolvedValue({ deletedCount: 1 });
    createDraftBatch.mockResolvedValue(batchResult([draft({ id: "d3", body: "新しい" })]));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「1件目」の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "削除" }));
    await paste(user, "新しい");
    expect(sendButton()).toBeEnabled();
    await user.click(sendButton());
    await screen.findByText("1件を登録しました");
    expect(deletePostDrafts).toHaveBeenCalledWith("a1", ["d1"]);
    expect(deletePostDrafts.mock.invocationCallOrder[0]!).toBeLessThan(
      createDraftBatch.mock.invocationCallOrder[0]!,
    );
  });

  it("送信中は送るボタンと欄が無効になり、失敗して送り直すときは同じ clientRequestId を送る（FR-015）", async () => {
    const user = userEvent.setup();
    let reject: (e: unknown) => void = () => {};
    createDraftBatch.mockImplementationOnce(() => new Promise((_, r) => (reject = r)));
    createDraftBatch.mockResolvedValueOnce(batchResult([draft()]));
    renderPage();
    await screen.findByText(/まだ下書きがありません/);
    await paste(user, "A");
    await user.click(sendButton());
    await waitFor(() => expect(composer()).toBeDisabled());
    expect(sendButton()).toBeDisabled();
    reject(new ApiError("API_UNREACHABLE", 0));
    await user.click(await screen.findByRole("button", { name: "もう一度送る" }));
    await screen.findByText("1件を登録しました");
    const [first, second] = createDraftBatch.mock.calls.map(
      (c) => (c[1] as { clientRequestId: string }).clientRequestId,
    );
    expect(second).toBe(first);
  });

  it("空・空白だけのときは送れない。51件分を貼ると、送らずに上限の案内が出る（FR-014）", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/まだ下書きがありません/);
    expect(sendButton()).toBeDisabled();
    await paste(user, "   ");
    expect(sendButton()).toBeDisabled();
    await user.clear(composer());
    await paste(user, Array.from({ length: 51 }, (_, i) => `投稿${i}`).join("\n@@@\n"));
    await user.click(sendButton());
    expect(await screen.findByText(/一度に登録できるのは50件・50,000文字まで/)).toBeInTheDocument();
    expect(createDraftBatch).not.toHaveBeenCalled();
  });

  it("区切りがない・上限を超える下書きがあるときの案内", async () => {
    const user = userEvent.setup();
    createDraftBatch.mockResolvedValue(
      batchResult([draft()], { delimiterFound: false, overLimitCount: 1 }),
    );
    renderPage();
    await screen.findByText(/まだ下書きがありません/);
    await paste(user, "区切りのない投稿");
    await user.click(sendButton());
    expect(
      await screen.findByText("区切り（@@@）が見つからなかったため、1件として登録しました"),
    ).toBeInTheDocument();
    expect(screen.getByText("そのうち1件はThreadsの上限を超えています")).toBeInTheDocument();
  });

  it("409 ITEM_LIMIT_REACHED は投稿ストック用の文言を出し、再試行は出さず、一覧を取り直す", async () => {
    const user = userEvent.setup();
    createDraftBatch.mockRejectedValue(new ApiError("ITEM_LIMIT_REACHED", 409));
    renderPage();
    await screen.findByText(/まだ下書きがありません/);
    expect(listPostDrafts).toHaveBeenCalledTimes(1);
    await paste(user, "A");
    await user.click(sendButton());
    expect(
      await screen.findByText(
        "要確認の下書きが上限（500件）に達しています。不要な下書きを削除してから登録してください。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "もう一度送る" })).not.toBeInTheDocument();
    await waitFor(() => expect(listPostDrafts).toHaveBeenCalledTimes(2));
    expect(composer()).toHaveValue("A");
  });

  it("400 PASTE_TOO_LARGE（draft:12）では「12件目」が案内に出る", async () => {
    const user = userEvent.setup();
    createDraftBatch.mockRejectedValue(new ApiError("PASTE_TOO_LARGE", 400, ["draft:12"]));
    renderPage();
    await screen.findByText(/まだ下書きがありません/);
    await paste(user, "A");
    await user.click(sendButton());
    expect(
      await screen.findByText(/^12件目が2,000文字を超えています。一度に登録できるのは/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "もう一度送る" })).not.toBeInTheDocument();
  });

  it("要確認が上限に達していると、一覧の上に案内が出て送るボタンが無効になる", async () => {
    const user = userEvent.setup();
    listPostDrafts.mockResolvedValue({
      ...listResponse({ items: [draft()] }),
      limits: { needsReview: 1, approved: 500 },
    });
    renderPage();
    expect(
      await screen.findByText(/要確認の下書きが上限（500件）に達しています/),
    ).toBeInTheDocument();
    await paste(user, "A");
    expect(sendButton()).toBeDisabled();
  });

  it("書きかけの内容があるまま移動しようとすると、未保存の警告が出る（FR-022）", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/まだ下書きがありません/);
    await paste(user, "書きかけ");
    await user.click(screen.getByRole("link", { name: "ホームへ" }));
    expect(await screen.findByText("保存していない変更があります")).toBeInTheDocument();
  });

  function renderFromCreate() {
    const router = createMemoryRouter(
      [
        {
          path: "/accounts/:accountId",
          element: (
            <UnsavedChangesProvider>
              <Outlet context={{ account }} />
            </UnsavedChangesProvider>
          ),
          children: [{ path: "stock", element: <StockPage /> }],
        },
      ],
      { initialEntries: [{ pathname: "/accounts/a1/stock", state: { startCreate: true } }] },
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  it("「投稿をつくる」から来たら、プロンプトのカードの「コピー」にフォーカスが当たる（specs/004 Clarifications 2026-10-05）", async () => {
    renderFromCreate();
    const copy = await screen.findByRole("button", { name: "コピー" });
    await waitFor(() => expect(copy).toHaveFocus());
    expect(composer()).not.toHaveFocus();
  });

  it("プロンプトを作れないとき（プラン1）は、「投稿をつくる」で欄にフォーカスが当たる（003 FR-021）", async () => {
    listPostDrafts.mockResolvedValue(listResponse({ canGeneratePrompt: false }));
    renderFromCreate();
    await waitFor(() => expect(composer()).toHaveFocus());
  });
});

describe("下書きの確認・修正・削除（US3）", () => {
  const items = [
    draft({ id: "d1", body: "1件目の下書き" }),
    draft({ id: "d2", position: 1, body: "2件目の下書き" }),
    draft({ id: "d3", position: 2, body: "3件目の下書き" }),
  ];

  beforeEach(() => {
    listPostDrafts.mockResolvedValue(listResponse({ items }));
  });

  /** 直近の削除のトーストの「元に戻す」を押す */
  const clickUndo = () =>
    act(() => {
      const opts = toastSuccess.mock.lastCall?.[1] as {
        action: { label: string; onClick: () => void };
      };
      expect(opts.action.label).toBe("元に戻す");
      opts.action.onClick();
    });

  it("選ぶと選択のバーが出て、「選んだ下書きを削除」で確認なしに一覧から消え、5秒後に選んだIDで削除する（FR-020）", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      deletePostDrafts.mockImplementation(async () => {
        listPostDrafts.mockResolvedValue(listResponse({ items: [items[1]!] }));
        return { deletedCount: 2 };
      });
      renderPage();
      await user.click(await screen.findByRole("checkbox", { name: "「1件目の下書き」を選択" }));
      await user.click(screen.getByRole("checkbox", { name: "「3件目の下書き」を選択" }));
      expect(screen.getByText("2件を選択中")).toBeInTheDocument();
      expect(
        screen.queryByRole("textbox", { name: "AIの返信を貼り付ける欄" }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "選んだ下書きを削除" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByText("1件目の下書き")).not.toBeInTheDocument();
      expect(screen.queryByText("3件目の下書き")).not.toBeInTheDocument();
      expect(screen.getByText("2件目の下書き")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "要確認 1" })).toBeInTheDocument();
      expect(toastSuccess).toHaveBeenLastCalledWith("2件の下書きを削除しました", expect.anything());
      expect(screen.queryByText(/件を選択中/)).not.toBeInTheDocument();
      expect(deletePostDrafts).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(5000));
      expect(deletePostDrafts).toHaveBeenCalledWith("a1", ["d1", "d3"]);
      await waitFor(() => expect(listPostDrafts).toHaveBeenCalledTimes(2));
      expect(screen.queryByText("1件目の下書き")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("「元に戻す」を押すと一覧に戻り、削除のAPIを呼ばない", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「2件目の下書き」の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "削除" }));
    expect(screen.queryByText("2件目の下書き")).not.toBeInTheDocument();
    expect(toastSuccess).toHaveBeenLastCalledWith("1件の下書きを削除しました", expect.anything());
    clickUndo();
    expect(await screen.findByText("2件目の下書き")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(deletePostDrafts).not.toHaveBeenCalled();
  });

  it("次の削除をすると、前の削除はその時点で確定する", async () => {
    const user = userEvent.setup();
    deletePostDrafts.mockResolvedValue({ deletedCount: 1 });
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「1件目の下書き」の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "「2件目の下書き」の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "削除" }));
    expect(deletePostDrafts).toHaveBeenCalledTimes(1);
    expect(deletePostDrafts).toHaveBeenCalledWith("a1", ["d1"]);
  });

  it("画面を離れると、待っている削除をその時点で確定する", async () => {
    const user = userEvent.setup();
    deletePostDrafts.mockResolvedValue({ deletedCount: 1 });
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「3件目の下書き」の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "削除" }));
    await user.click(screen.getByRole("link", { name: "ホームへ" }));
    await screen.findByText("ホームの中身");
    expect(deletePostDrafts).toHaveBeenCalledWith("a1", ["d3"]);
  });

  it("確定に失敗したら、下書きが一覧に戻り、失敗を伝える", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      deletePostDrafts.mockRejectedValue(new ApiError("API_UNREACHABLE", 0));
      renderPage();
      await user.click(await screen.findByRole("button", { name: "「1件目の下書き」の操作" }));
      await user.click(await screen.findByRole("menuitem", { name: "削除" }));
      expect(screen.queryByText("1件目の下書き")).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(5000));
      expect(await screen.findByText("1件目の下書き")).toBeInTheDocument();
      expect(toastError).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("「すべて選択」と「選択を解除」", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "すべて選択" }));
    expect(screen.getByText("3件を選択中")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "選択を解除" }));
    expect(screen.queryByText(/件を選択中/)).not.toBeInTheDocument();
  });

  it("「⋯」の「編集」で本文を直して保存すると一覧に反映される（FR-019）", async () => {
    const user = userEvent.setup();
    updatePostDraft.mockImplementation(async (_a: string, id: string, req: { body: string }) => {
      const updated = { ...items[0]!, id, body: req.body, version: 2 };
      listPostDrafts.mockResolvedValue(listResponse({ items: [updated, items[1]!, items[2]!] }));
      return { draft: updated, reopened: false };
    });
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「1件目の下書き」の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "編集" }));
    const dialog = await screen.findByRole("dialog", { name: "下書きを編集" });
    const body = within(dialog).getByRole("textbox", { name: /本文/ });
    await user.clear(body);
    await user.type(body, "直した下書き");
    expect(within(dialog).getByText("6文字")).toBeInTheDocument();
    await user.click(within(dialog).getAllByRole("button", { name: "保存" }).at(-1)!);
    expect(updatePostDraft).toHaveBeenCalledWith("a1", "d1", {
      body: "直した下書き",
      expectedVersion: 1,
    });
    expect(await screen.findByText("直した下書き")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("編集の保存で 409 なら競合のダイアログが出る", async () => {
    const user = userEvent.setup();
    updatePostDraft.mockRejectedValue(
      new ApiError("STALE_UPDATE", 409, [], {
        ...items[0]!,
        body: "他で直した",
        version: 2,
        updatedAt: "2026-10-03T01:00:00.000Z",
      }),
    );
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「1件目の下書き」の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "編集" }));
    const dialog = await screen.findByRole("dialog", { name: "下書きを編集" });
    await user.type(within(dialog).getByRole("textbox", { name: /本文/ }), "追記");
    await user.click(within(dialog).getAllByRole("button", { name: "保存" }).at(-1)!);
    expect(await screen.findByText("他の場所で更新されています")).toBeInTheDocument();
  });
});

// ---- specs/004-review-approval US1：承認・却下（contracts/ui-routes.md「状態のタブ」「承認」「却下理由の入力」「選択のバー」）----

describe("承認・却下（004 US1）", () => {
  const reviewed = (
    d: PostDraft,
    status: PostDraft["status"],
    extra: Partial<PostDraft> = {},
  ): PostDraft => ({
    ...d,
    status,
    version: d.version + 1,
    reviewedAt: status === "needs_review" ? null : "2026-10-04T01:00:00.000Z",
    ...extra,
  });
  const needs = [
    draft({ id: "n1", body: "1件目の下書き" }),
    draft({ id: "n2", body: "2件目の下書き", position: 1 }),
    draft({ id: "n3", body: "絶対に伸びる", position: 2 }),
  ];
  const approvedDraft = reviewed(
    draft({ id: "p1", body: "承認した投稿", batchId: "b0" }),
    "approved",
  );
  const rejectedDraft = reviewed(
    draft({ id: "r1", body: "却下した投稿", batchId: "b0", position: 1 }),
    "rejected",
    {
      rejectReasons: ["tone"],
      rejectNote: "語尾がきつい",
    },
  );
  const ngWords = [
    { id: "w1", word: "絶対", normalized: "絶対", createdAt: "2026-10-04T00:00:00.000Z" },
  ];

  beforeEach(() => {
    listPostDrafts.mockResolvedValue(
      listResponse({ items: needs, approved: [approvedDraft], rejected: [rejectedDraft], ngWords }),
    );
    reviewPostDrafts.mockImplementation(
      async (_a: string, req: { action: string; items: { id: string }[] }) => {
        const all = [...needs, approvedDraft, rejectedDraft];
        const target = { approve: "approved", reject: "rejected", reopen: "needs_review" }[
          req.action
        ] as PostDraft["status"];
        return {
          updated: req.items.map((i) =>
            reviewed(
              all.find((d) => d.id === i.id)!,
              target,
            ),
          ),
          skipped: [],
          counts: { needsReview: 2, approved: 2, rejected: 1 },
        };
      },
    );
  });

  it("4つのタブに件数が出て、?tab=approved で承認済みのタブが開く（FR-001）", async () => {
    renderPage("/accounts/a1/stock?tab=approved");
    expect(await screen.findByRole("tab", { name: "要確認 3" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "却下 1" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "承認済み 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("承認した投稿")).toBeInTheDocument();
    expect(
      screen.getByText("自動投稿はオフです。"),
    ).toBeInTheDocument();
  });

  it("「承認」で状態を変え、トーストの「元に戻す」で要確認に戻す（FR-002・FR-008）", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「1件目の下書き」を承認" }));
    expect(reviewPostDrafts).toHaveBeenCalledWith("a1", {
      requestId: expect.any(String),
      action: "approve",
      items: [{ id: "n1", expectedVersion: 1 }],
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("承認しました", expect.anything()),
    );
    const undo = toastSuccess.mock.calls.at(-1)![1].action.onClick as () => void;
    await act(async () => undo());
    expect(reviewPostDrafts).toHaveBeenLastCalledWith("a1", {
      requestId: expect.any(String),
      action: "reopen",
      items: [{ id: "n1", expectedVersion: 2 }],
    });
  });

  it("却下理由：候補が6つあり、空なら確定できず、選ぶと理由つきで却下する（FR-003）", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「1件目の下書き」を却下" }));
    const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
    const chips = within(within(dialog).getByRole("group", { name: "よくある理由" })).getAllByRole(
      "button",
    );
    expect(chips.map((c) => c.textContent)).toEqual([
      "似た投稿がある",
      "トーンが違う",
      "内容が薄い",
      "事実と違う",
      "宣伝っぽすぎる",
      "規約に触れそう",
    ]);
    expect(within(dialog).getByText("理由を1つ以上選ぶか、書いてください")).toBeInTheDocument();
    for (const b of within(dialog).getAllByRole("button", { name: "却下する" }))
      expect(b).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "トーンが違う" }));
    await user.click(within(dialog).getAllByRole("button", { name: "却下する" }).at(-1)!);
    expect(reviewPostDrafts).toHaveBeenCalledWith("a1", {
      requestId: expect.any(String),
      action: "reject",
      items: [{ id: "n1", expectedVersion: 1 }],
      reject: { reasons: ["tone"], note: "" },
    });
  });

  it("却下のタブに却下理由が出る（FR-012）", async () => {
    renderPage("/accounts/a1/stock?tab=rejected");
    expect(await screen.findByText("却下理由：トーンが違う / 語尾がきつい")).toBeInTheDocument();
  });

  it("まとめて承認：飛ばしたものがあれば件数と理由を出し、飛ばした下書きは選んだまま（FR-004・FR-005）", async () => {
    const user = userEvent.setup();
    reviewPostDrafts.mockResolvedValue({
      updated: [reviewed(needs[0]!, "approved"), reviewed(needs[1]!, "approved")],
      skipped: [{ id: "n3", reason: "NG_WORD", latest: needs[2] }],
      counts: { needsReview: 1, approved: 3, rejected: 1 },
    });
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "すべて選択" }));
    const bar = screen.getByRole("toolbar", { name: "選んだ下書きの操作" });
    expect(within(bar).getByRole("button", { name: "まとめて却下" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "選んだ下書きを削除" })).toBeInTheDocument();
    await user.click(within(bar).getByRole("button", { name: "まとめて承認" }));
    // 責任の確認（FR-004b）。NGワードの1件は承認されないことも出る
    const confirm = await screen.findByRole("dialog", { name: "選んだ3件を承認します" });
    expect(
      within(confirm).getByText("うち1件はNGワード・Threadsの上限に当たるため、承認されません"),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "2件を承認する" }));
    await waitFor(() =>
      expect(toastWarning).toHaveBeenCalledWith(
        "2件を承認しました。1件は承認できませんでした（NGワード 1件）",
        expect.anything(),
      ),
    );
    expect(screen.getByRole("checkbox", { name: "「絶対に伸びる」を選択" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "「1件目の下書き」を選択" })).not.toBeChecked();
  });

  it("選択のバーの中身はタブごとに変わる", async () => {
    const user = userEvent.setup();
    renderPage("/accounts/a1/stock?tab=approved");
    await user.click(await screen.findByRole("checkbox", { name: "「承認した投稿」を選択" }));
    let bar = screen.getByRole("toolbar", { name: "選んだ下書きの操作" });
    expect(within(bar).getByRole("button", { name: "要確認に戻す" })).toBeInTheDocument();
    expect(
      within(bar).queryByRole("button", { name: "選んだ下書きを削除" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "却下 1" }));
    await user.click(await screen.findByRole("checkbox", { name: "「却下した投稿」を選択" }));
    bar = screen.getByRole("toolbar", { name: "選んだ下書きの操作" });
    expect(within(bar).getByRole("button", { name: "選んだ下書きを削除" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "要確認に戻す" })).toBeInTheDocument();
  });

  it("NGワードを含む下書きは「承認」が押せず、理由が出る（FR-005）", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "「絶対に伸びる」を承認" })).toBeDisabled();
    expect(
      screen.getByText("NGワードを含むため承認できません。本文を直すか却下してください"),
    ).toBeInTheDocument();
  });

  it("承認済みの「編集」で案内が出て、要確認に戻ったら知らせる（FR-007）", async () => {
    const user = userEvent.setup();
    updatePostDraft.mockResolvedValue({
      draft: reviewed(approvedDraft, "needs_review"),
      reopened: true,
    });
    renderPage("/accounts/a1/stock?tab=approved");
    await user.click(await screen.findByRole("button", { name: "「承認した投稿」の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "編集" }));
    const dialog = await screen.findByRole("dialog", { name: "下書きを編集" });
    expect(
      within(dialog).getByText("保存すると要確認に戻り、もう一度承認が必要になります"),
    ).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /本文/ }), "！");
    await user.click(within(dialog).getAllByRole("button", { name: "保存" }).at(-1)!);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "直したので、要確認に戻しました。もう一度承認してください",
      ),
    );
  });

  it("1件の操作で skipped なら、理由の文言を出す", async () => {
    const user = userEvent.setup();
    reviewPostDrafts.mockResolvedValue({
      updated: [],
      skipped: [{ id: "n1", reason: "STALE", latest: needs[0] }],
      counts: { needsReview: 3, approved: 1, rejected: 1 },
    });
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「1件目の下書き」を承認" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "他の場所で更新されています。最新の内容を表示しました。",
      ),
    );
  });
});

describe("NGワードのラベルと強調（004 US2、FR-016）", () => {
  it("要確認の下書きに「NGワード：絶対」が出て、本文の「絶対」が強調される", async () => {
    listPostDrafts.mockResolvedValue(
      listResponse({
        items: [draft({ id: "n1", body: "絶対に伸びる方法" })],
        ngWords: [
          { id: "w1", word: "絶対", normalized: "絶対", createdAt: "2026-10-04T00:00:00.000Z" },
        ],
      }),
    );
    renderPage();
    expect(await screen.findByText("NGワード：絶対")).toBeInTheDocument();
    const mark = document.querySelector("mark");
    expect(mark?.textContent).toBe("絶対");
  });

  it("編集のダイアログでも、入力に合わせてNGワードのラベルが出る", async () => {
    const user = userEvent.setup();
    listPostDrafts.mockResolvedValue(
      listResponse({
        items: [draft({ id: "n1", body: "ふつうの投稿" })],
        ngWords: [
          { id: "w1", word: "絶対", normalized: "絶対", createdAt: "2026-10-04T00:00:00.000Z" },
        ],
      }),
    );
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「ふつうの投稿」の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "編集" }));
    const dialog = await screen.findByRole("dialog", { name: "下書きを編集" });
    expect(within(dialog).queryByText(/NGワード：/)).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /本文/ }), "絶対");
    expect(within(dialog).getByText("NGワード：絶対")).toBeInTheDocument();
  });
});

describe("重複検知（004 US3、FR-026〜FR-029）", () => {
  const base = "朝の散歩を続けて三か月がたった。体より先に気持ちが軽くなった気がする。";
  const approvedTwin: PostDraft = draft({
    id: "p1",
    body: base,
    batchId: "b0",
    status: "approved",
    version: 2,
    reviewedAt: "2026-10-04T01:00:00.000Z",
  });
  const twin = draft({ id: "n1", body: base.replace("三か月", "四か月") });
  const other = draft({
    id: "n2",
    body: "仕事の段取りを前日の夜に決めておくと、次の朝の迷いがぐっと減る。",
    position: 1,
  });

  beforeEach(() => {
    listPostDrafts.mockResolvedValue(
      listResponse({ items: [twin, other], approved: [approvedTwin] }),
    );
    reviewPostDrafts.mockResolvedValue({
      updated: [],
      skipped: [],
      counts: { needsReview: 2, approved: 1, rejected: 0 },
    });
  });

  it("承認済みとほぼ同じ下書きは注意の色の類似度と「似ている投稿があります」。違う投稿は低い類似度だけ", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: /^類似度 9\d%・似ている投稿があります$/ }),
    ).toBeInTheDocument();
    const low = screen.getAllByRole("button", { name: /^類似度 \d+%$/ });
    expect(low.length).toBeGreaterThanOrEqual(1);
  });

  it("ラベルを押すと「似ている投稿」に相手の状態と本文が出て、押すと承認済みのタブに移る", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /似ている投稿があります/ }));
    const panel = screen.getByRole("region", { name: "似ている投稿" });
    expect(within(panel).getByText("承認済み")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: /朝の散歩を続けて三か月/ }));
    expect(await screen.findByRole("tab", { name: /承認済み/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("似ている下書きの却下で「似た投稿がある」が最初から選ばれている。80%以上でも「承認」は押せる", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: /似ている投稿があります/ });
    expect(
      screen.getByRole("button", { name: `「${twin.body.slice(0, 20)}…」を承認` }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: `「${twin.body.slice(0, 20)}…」を却下` }));
    const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
    expect(within(dialog).getByRole("button", { name: "似た投稿がある" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("まとめて却下では、選んだうち1件でも似ていれば最初から選ばれている", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: /似ている投稿があります/ });
    await user.click(screen.getByRole("checkbox", { name: "すべて選択" }));
    await user.click(screen.getByRole("button", { name: "まとめて却下" }));
    const dialog = await screen.findByRole("dialog", { name: "2件を却下する理由" });
    expect(within(dialog).getByRole("button", { name: "似た投稿がある" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("プロンプトのカードの要約（004 FR-025）", () => {
  it("投稿ルール・NGワード・却下の件数が足される（0件の項目は出ない）", async () => {
    getPrompt.mockResolvedValue(
      promptResponse({ coreRuleCount: 3, ngWordCount: 2, rejectedCount: 0 }),
    );
    renderPage();
    expect(
      await screen.findByText(
        "課題 11/16・宣伝の対象 1件・参考投稿 3件・ルール 3件・NGワード 2語を反映",
        { normalizer: (s) => s.replace(/\s+/g, " ").trim() },
      ),
    ).toBeInTheDocument();
  });

  it("反応が低かった投稿の件数が足される（006）", async () => {
    getPrompt.mockResolvedValue(promptResponse({ rejectedCount: 2, poorPostCount: 5 }));
    renderPage();
    expect(
      await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件・却下 2件・反応が低かった投稿 5件を反映", {
        normalizer: (s) => s.replace(/\s+/g, " ").trim(),
      }),
    ).toBeInTheDocument();
  });
});

describe("規約に注意（004 US5、FR-039・FR-040・FR-043）", () => {
  const bait = draft({ id: "n1", body: "この投稿にいいねした人の中から抽選でプレゼント" });
  const bait2 = draft({ id: "n2", body: "誰でも必ず稼げる方法を教えます", position: 1 });
  const plain = draft({ id: "n3", body: "朝の散歩を続けて三か月がたった", position: 2 });
  const approvedBait: PostDraft = draft({
    id: "p1",
    body: "飲むだけで痩せるサプリの話",
    batchId: "b0",
    status: "approved",
    version: 2,
    reviewedAt: "2026-10-04T01:00:00.000Z",
  });

  beforeEach(() => {
    listPostDrafts.mockResolvedValue(
      listResponse({ items: [bait, bait2, plain], approved: [approvedBait] }),
    );
    reviewPostDrafts.mockImplementation(async (_a: string, req: { items: { id: string }[] }) => ({
      updated: req.items.map((i) => ({
        ...[bait, bait2, plain, approvedBait].find((d) => d.id === i.id)!,
        version: 3,
      })),
      skipped: [],
      counts: { needsReview: 2, approved: 2, rejected: 0 },
    }));
  });

  it("ラベルと強調が出て、押すと関わる規約と言い換えの方向が出る", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "規約に注意：見返りでの反応集め" }));
    const panel = screen.getByRole("region", { name: "規約に注意の説明" });
    expect(
      within(panel).getByText(/Metaコミュニティ規定「スパム」.*触れるおそれのある表現です/),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /スパム/ })).toHaveAttribute(
      "href",
      "https://transparency.meta.com/policies/community-standards/spam/",
    );
    expect([...document.querySelectorAll("mark")].map((m) => m.textContent)).toContain(
      "いいねした人の中から抽選でプレゼント",
    );
  });

  it("承認で確認が出る。キャンセルなら送らず、「承認する」なら confirmPolicyCaution: true で送る", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: `「${bait.body.slice(0, 20)}…」を承認` }),
    );
    let dialog = await screen.findByRole("dialog", {
      name: "Threadsの規約に触れるおそれのある表現があります",
    });
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(reviewPostDrafts).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: `「${bait.body.slice(0, 20)}…」を承認` }));
    dialog = await screen.findByRole("dialog", {
      name: "Threadsの規約に触れるおそれのある表現があります",
    });
    await user.click(within(dialog).getByRole("button", { name: "承認する" }));
    expect(reviewPostDrafts).toHaveBeenCalledWith("a1", {
      requestId: expect.any(String),
      action: "approve",
      items: [{ id: "n1", expectedVersion: 1 }],
      confirmPolicyCaution: true,
    });
  });

  it("規約に注意でない下書きは、確認なしで承認する", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: "「朝の散歩を続けて三か月がたった」を承認" }),
    );
    expect(reviewPostDrafts).toHaveBeenCalledWith("a1", {
      requestId: expect.any(String),
      action: "approve",
      items: [{ id: "n3", expectedVersion: 1 }],
    });
  });

  it("まとめて承認で、選んだうち2件が規約に注意なら、責任の確認1回にその件数が出て、confirmPolicyCaution: true で送る", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "すべて選択" }));
    await user.click(screen.getByRole("button", { name: "まとめて承認" }));
    const dialog = await screen.findByRole("dialog", { name: "選んだ3件を承認します" });
    expect(
      within(dialog).getByText("うち2件に、Threadsの規約に触れるおそれのある表現があります"),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "3件を承認する" }));
    // 規約に注意の確認は、責任の確認で済ませる（続けて2回は出ない）
    expect(
      screen.queryByRole("dialog", { name: "Threadsの規約に触れるおそれのある表現があります" }),
    ).not.toBeInTheDocument();
    expect(reviewPostDrafts).toHaveBeenCalledWith("a1", {
      requestId: expect.any(String),
      action: "approve",
      items: [
        { id: "n1", expectedVersion: 1 },
        { id: "n2", expectedVersion: 1 },
        { id: "n3", expectedVersion: 1 },
      ],
      confirmPolicyCaution: true,
    });
  });

  it("却下で「規約に触れそう」が最初から選ばれている", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: `「${bait.body.slice(0, 20)}…」を却下` }),
    );
    const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
    expect(within(dialog).getByRole("button", { name: "規約に触れそう" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("承認済みの規約に注意の下書きには、要確認に戻すことを勧め、押すと reopen を送る", async () => {
    const user = userEvent.setup();
    renderPage("/accounts/a1/stock?tab=approved");
    expect(
      await screen.findByText(
        "規約に注意の表現があります。要確認に戻して確かめることをおすすめします",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "要確認に戻す" }));
    expect(reviewPostDrafts).toHaveBeenCalledWith("a1", {
      requestId: expect.any(String),
      action: "reopen",
      items: [{ id: "p1", expectedVersion: 2 }],
    });
  });

  it("画面に「安全」「規約に適合」「違反しない」「問題ありません」が出ない", async () => {
    renderPage();
    await screen.findByRole("button", { name: "規約に注意：見返りでの反応集め" });
    for (const word of ["安全", "規約に適合", "違反しない", "問題ありません"]) {
      expect(document.body.textContent).not.toContain(word);
    }
  });
});

describe("まとめて選ぶ方法と、まとめて承認の前の責任の確認（004 FR-004a・FR-004b、Clarifications 2026-10-05）", () => {
  const ngWords = [
    { id: "w1", word: "絶対", normalized: "絶対", createdAt: "2026-10-05T00:00:00.000Z" },
  ];
  const base = "朝の散歩を続けて三か月がたった。体より先に気持ちが軽くなった気がする。";
  const clean1 = draft({
    id: "c1",
    body: "仕事の段取りを前日の夜に決めておくと、次の朝の迷いが減る",
    batchId: "b2",
  });
  const clean2 = draft({
    id: "c2",
    body: "新しい本を読み始めた。最初の章から引き込まれている",
    batchId: "b2",
    position: 1,
  });
  const ng = draft({ id: "x1", body: "絶対に伸びる方法をまとめてみた", batchId: "b1" });
  const policy = draft({
    id: "x2",
    body: "誰でも必ず稼げる方法を教えます",
    batchId: "b1",
    position: 1,
  });
  const similar = draft({
    id: "x3",
    body: base.replace("三か月", "四か月"),
    batchId: "b1",
    position: 2,
  });
  const approvedTwin = draft({
    id: "p1",
    body: base,
    batchId: "b0",
    status: "approved",
    version: 2,
    reviewedAt: "2026-10-04T01:00:00.000Z",
  });

  beforeEach(() => {
    listPostDrafts.mockResolvedValue(
      listResponse({
        items: [clean1, clean2, ng, policy, similar],
        approved: [approvedTwin],
        ngWords,
      }),
    );
    reviewPostDrafts.mockImplementation(async (_a: string, req: { items: { id: string }[] }) => ({
      updated: req.items.map((i) => ({
        ...[clean1, clean2].find((d) => d.id === i.id)!,
        version: 2,
      })),
      skipped: [],
      counts: { needsReview: 3, approved: 3, rejected: 0 },
    }));
  });

  it("「承認できるものを選択」で、NGワード・規約に注意・似ている投稿以外だけが選ばれる", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: /似ている投稿があります/ });
    await user.click(screen.getByRole("button", { name: "選び方" }));
    await user.click(await screen.findByRole("menuitem", { name: "承認できるものを選択（2件）" }));
    expect(screen.getByText("2件を選択中")).toBeInTheDocument();
    for (const d of [clean1, clean2]) {
      expect(
        screen.getByRole("checkbox", { name: `「${d.body.slice(0, 20)}…」を選択` }),
      ).toBeChecked();
    }
    for (const d of [ng, policy, similar]) {
      const name = d.body.length > 20 ? `「${d.body.slice(0, 20)}…」を選択` : `「${d.body}」を選択`;
      expect(screen.getByRole("checkbox", { name })).not.toBeChecked();
    }
  });

  it("登録のまとまりの「この◯件を選択」で、そのまとまりの下書きだけが選ばれる", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "この2件を選択" }));
    expect(screen.getByText("2件を選択中")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "この3件を選択" }));
    expect(screen.getByText("5件を選択中")).toBeInTheDocument();
  });

  it("まとめて承認で責任の確認が出る。キャンセルなら送らず、確認すると送る", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "この2件を選択" }));
    await user.click(screen.getByRole("button", { name: "まとめて承認" }));
    let dialog = await screen.findByRole("dialog", { name: "選んだ2件を承認します" });
    expect(
      within(dialog).getByText(
        /投稿の内容は、あなた（アカウントの運用者）の責任のもとで公開されます/,
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(reviewPostDrafts).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "まとめて承認" }));
    dialog = await screen.findByRole("dialog", { name: "選んだ2件を承認します" });
    await user.click(within(dialog).getByRole("button", { name: "2件を承認する" }));
    expect(reviewPostDrafts).toHaveBeenCalledWith("a1", {
      requestId: expect.any(String),
      action: "approve",
      items: [
        { id: "c1", expectedVersion: 1 },
        { id: "c2", expectedVersion: 1 },
      ],
    });
  });

  it("1件ずつの承認では、責任の確認は出ない", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: `「${clean1.body.slice(0, 20)}…」を承認` }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(reviewPostDrafts).toHaveBeenCalledWith("a1", {
      requestId: expect.any(String),
      action: "approve",
      items: [{ id: "c1", expectedVersion: 1 }],
    });
  });
});

describe("PR #5 のCodexレビュー（2回目）への対応", () => {
  function renderWithRouter(state?: unknown) {
    const router = createMemoryRouter(
      [
        {
          path: "/accounts/:accountId",
          element: (
            <UnsavedChangesProvider>
              <Outlet context={{ account }} />
            </UnsavedChangesProvider>
          ),
          children: [{ path: "stock", element: <StockPage /> }],
        },
      ],
      { initialEntries: [{ pathname: "/accounts/a1/stock", state }] },
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return router;
  }
  const composer = () => screen.getByRole("textbox", { name: "AIの返信を貼り付ける欄" });

  it("500件を超える選択のまとめて却下は、500件ずつに分けて送る", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 501 }, (_, i) =>
      draft({
        id: `m${i}`,
        body: `まとめて却下する下書き${i}`,
        batchId: `b${Math.floor(i / 50)}`,
        position: i % 50,
      }),
    );
    listPostDrafts.mockResolvedValue(listResponse({ items: many }));
    reviewPostDrafts.mockImplementation(async (_a: string, req: { items: { id: string }[] }) => ({
      updated: req.items.map((i) => ({
        ...many.find((d) => d.id === i.id)!,
        status: "rejected",
        version: 2,
      })),
      skipped: [],
      counts: { needsReview: 0, approved: 0, rejected: 501 },
    }));
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "すべて選択" }));
    await user.click(screen.getByRole("button", { name: "まとめて却下" }));
    const dialog = await screen.findByRole("dialog", { name: "501件を却下する理由" });
    await user.click(within(dialog).getByRole("button", { name: "トーンが違う" }));
    await user.click(within(dialog).getAllByRole("button", { name: "却下する" }).at(-1)!);
    await waitFor(() => expect(reviewPostDrafts).toHaveBeenCalledTimes(2));
    expect(
      reviewPostDrafts.mock.calls.map((c) => (c[1] as { items: unknown[] }).items.length),
    ).toEqual([500, 1]);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("501件を却下しました", expect.anything()),
    );
  }, 60_000);

  it("承認済みが上限に近いと、確認に出る件数を残りの枠に合わせる", async () => {
    const user = userEvent.setup();
    const items = [
      "朝の光が窓から差し込んでくる",
      "新しい本を読み始めた。最初の章から",
      "仕事の段取りを前日の夜に決めておく",
    ].map((body, i) => draft({ id: `s${i}`, body, position: i }));
    listPostDrafts.mockResolvedValue({
      ...listResponse({ items }),
      counts: { needsReview: 3, approved: 499, rejected: 0 },
    });
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "すべて選択" }));
    await user.click(screen.getByRole("button", { name: "まとめて承認" }));
    const dialog = await screen.findByRole("dialog", { name: "選んだ3件を承認します" });
    expect(
      within(dialog).getByText(
        "承認済みの下書きが上限（500件）に近いため、承認されるのは1件までです",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "1件を承認する" })).toBeInTheDocument();
  });

  it("プラン1で下書きを選んでいる間に「投稿をつくる」を押すと、選択を解除して貼り付け欄にフォーカスする", async () => {
    const user = userEvent.setup();
    listPostDrafts.mockResolvedValue(
      listResponse({
        items: [draft({ id: "d1", body: "選んでおく下書き" })],
        canGeneratePrompt: false,
      }),
    );
    const router = renderWithRouter();
    await user.click(await screen.findByRole("checkbox", { name: "「選んでおく下書き」を選択" }));
    expect(screen.getByText("1件を選択中")).toBeInTheDocument();
    await act(() => router.navigate("/accounts/a1/stock", { state: { startCreate: true } }));
    await waitFor(() => expect(composer()).toHaveFocus());
    expect(screen.queryByText(/件を選択中/)).not.toBeInTheDocument();
  });

  it("プロンプトの読み込みに失敗しても、「再読み込み」で「コピー」が出た時点でフォーカスする", async () => {
    const user = userEvent.setup();
    getPrompt.mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0));
    renderWithRouter({ startCreate: true });
    await user.click(await screen.findByRole("button", { name: "再読み込み" }));
    const copy = await screen.findByRole("button", { name: "コピー" });
    await waitFor(() => expect(copy).toHaveFocus());
  });

  it("画面を開いた後にプロンプトが使えなくなったら、「投稿をつくる」で貼り付け欄にフォーカスする", async () => {
    getPrompt.mockRejectedValue(new ApiError("BILLING_REQUIRED", 403, ["trial_ended"]));
    renderWithRouter({ startCreate: true });
    expect(await screen.findByText("今はAIプロンプトを作れません")).toBeInTheDocument();
    await waitFor(() => expect(composer()).toHaveFocus());
  });
});

describe("PR #5 のCodexレビュー（3回目）への対応", () => {
  const composer = () => screen.getByRole("textbox", { name: "AIの返信を貼り付ける欄" });

  /** ホームと投稿ストックを持つルーター。同じ QueryClient のまま移動できる */
  function renderRoutes(initial: { pathname: string; state?: unknown }) {
    const router = createMemoryRouter(
      [
        {
          path: "/accounts/:accountId",
          element: (
            <UnsavedChangesProvider>
              <Outlet context={{ account }} />
            </UnsavedChangesProvider>
          ),
          children: [
            { index: true, element: <p>ホームの中身</p> },
            { path: "stock", element: <StockPage /> },
          ],
        },
      ],
      { initialEntries: [initial] },
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return router;
  }

  it("再訪で読み込み直しが失敗しても、「再読み込み」で成功した時点で「コピー」にフォーカスする", async () => {
    const user = userEvent.setup();
    const router = renderRoutes({ pathname: "/accounts/a1/stock" });
    await screen.findByRole("button", { name: "コピー" });
    await act(() => router.navigate("/accounts/a1"));
    await screen.findByText("ホームの中身");
    // キャッシュがある状態で、読み込み直しだけが失敗する
    getPrompt.mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0));
    await act(() => router.navigate("/accounts/a1/stock", { state: { startCreate: true } }));
    await user.click(await screen.findByRole("button", { name: "再読み込み" }));
    const copy = await screen.findByRole("button", { name: "コピー" });
    await waitFor(() => expect(copy).toHaveFocus());
  });

  it("プラン1で送信中に「投稿をつくる」を押しても、送信が終わって欄が使えるようになった時点でフォーカスする", async () => {
    const user = userEvent.setup();
    listPostDrafts.mockResolvedValue(listResponse({ canGeneratePrompt: false }));
    let finish: (v: DraftBatchResult) => void = () => {};
    createDraftBatch.mockImplementation(() => new Promise<DraftBatchResult>((r) => (finish = r)));
    const router = renderRoutes({ pathname: "/accounts/a1/stock" });
    await user.type(await screen.findByRole("textbox", { name: "AIの返信を貼り付ける欄" }), "A");
    await user.click(screen.getByRole("button", { name: "投稿ストックに登録する" }));
    await waitFor(() => expect(composer()).toBeDisabled());
    await act(() => router.navigate("/accounts/a1/stock", { state: { startCreate: true } }));
    expect(composer()).not.toHaveFocus();
    await act(async () => finish(batchResult([draft({ id: "n1", body: "A" })])));
    await waitFor(() => expect(composer()).toHaveFocus());
  });

  // 501件を「まとめて却下」する（500件＋1件の2回に分かれる）
  const many = Array.from({ length: 501 }, (_, i) =>
    draft({
      id: `m${i}`,
      body: `途中で失敗する下書き${i}`,
      batchId: `b${Math.floor(i / 50)}`,
      position: i % 50,
    }),
  );
  const ok =
    (status: PostDraft["status"]) => async (_a: string, req: { items: { id: string }[] }) => ({
      updated: req.items.map((i) => ({ ...many.find((d) => d.id === i.id)!, status, version: 2 })),
      skipped: [],
      counts: { needsReview: 0, approved: 0, rejected: 501 },
    });
  async function rejectAll(user: ReturnType<typeof userEvent.setup>) {
    listPostDrafts.mockResolvedValue(listResponse({ items: many }));
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "すべて選択" }));
    await user.click(screen.getByRole("button", { name: "まとめて却下" }));
    const dialog = await screen.findByRole("dialog", { name: "501件を却下する理由" });
    await user.click(within(dialog).getByRole("button", { name: "トーンが違う" }));
    await user.click(within(dialog).getAllByRole("button", { name: "却下する" }).at(-1)!);
  }
  const requestIds = () =>
    reviewPostDrafts.mock.calls.map((c) => (c[1] as { requestId: string }).requestId);

  it("返事だけが失われても、同じ操作IDで送り直して結果を確かめる（PR #5 のCodexレビュー）", async () => {
    const user = userEvent.setup();
    reviewPostDrafts
      .mockImplementationOnce(ok("rejected"))
      .mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0))
      .mockImplementationOnce(ok("rejected"));
    await rejectAll(user);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("501件を却下しました", expect.anything()),
    );
    const ids = requestIds();
    expect(ids).toHaveLength(3);
    // 2つ目のまとまりの送り直しは、同じ操作ID
    expect(ids[2]).toBe(ids[1]);
    expect(ids[1]).not.toBe(ids[0]);
    expect(toastWarning).not.toHaveBeenCalled();
  }, 60_000);

  it("送り直しても返事が来なければ「結果を確認できませんでした」として、1つの通知で伝える", async () => {
    const user = userEvent.setup();
    reviewPostDrafts
      .mockImplementationOnce(ok("rejected"))
      .mockRejectedValue(new ApiError("API_UNREACHABLE", 0));
    await rejectAll(user);
    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1));
    expect(toastWarning.mock.calls[0]![0]).toBe(
      "500件を却下しました。1件は結果を確認できませんでした。一覧を読み込み直しました。それぞれの状態を確かめてから、必要ならもう一度操作してください。",
    );
    // 1回目＋2つ目のまとまりの3回（送り直し2回）
    expect(reviewPostDrafts).toHaveBeenCalledTimes(4);
    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  }, 60_000);

  it("処理されなかったと確かな失敗（入力の誤り）は送り直さず、「送れませんでした」と伝える", async () => {
    const user = userEvent.setup();
    reviewPostDrafts
      .mockImplementationOnce(ok("rejected"))
      .mockRejectedValueOnce(new ApiError("VALIDATION_FAILED", 400, ["items"]));
    await rejectAll(user);
    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1));
    expect(toastWarning.mock.calls[0]![0]).toMatch(/^500件を却下しました。1件は送れませんでした。/);
    expect(reviewPostDrafts).toHaveBeenCalledTimes(2);
  }, 60_000);

  it("本文がJSONでない4xx（INTERNAL_ERROR・404）も、処理されなかったと確かな失敗として送り直さない", async () => {
    const user = userEvent.setup();
    reviewPostDrafts
      .mockImplementationOnce(ok("rejected"))
      .mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 404));
    await rejectAll(user);
    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1));
    expect(toastWarning.mock.calls[0]![0]).toMatch(/^500件を却下しました。1件は送れませんでした。/);
    expect(reviewPostDrafts).toHaveBeenCalledTimes(2);
  }, 60_000);

  it("1つ目のまとまりから返事が来なければ、そのまとまりは「結果を確認できませんでした」、残りは「送れませんでした」", async () => {
    const user = userEvent.setup();
    reviewPostDrafts.mockRejectedValue(new ApiError("API_UNREACHABLE", 0));
    await rejectAll(user);
    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1));
    expect(toastWarning.mock.calls[0]![0]).toBe(
      "500件は結果を確認できませんでした。1件は送れませんでした。一覧を読み込み直しました。それぞれの状態を確かめてから、必要ならもう一度操作してください。",
    );
    // 1つ目のまとまりを3回（送り直し2回）送り、2つ目は送らない
    expect(reviewPostDrafts).toHaveBeenCalledTimes(3);
    expect(new Set(requestIds()).size).toBe(1);
  }, 60_000);

  it("一覧の読み込み直しに失敗したら、読み込み直したとは言わない", async () => {
    const user = userEvent.setup();
    reviewPostDrafts
      .mockImplementationOnce(ok("rejected"))
      .mockRejectedValue(new ApiError("API_UNREACHABLE", 0));
    // 最初の表示だけ成功し、その後の一覧の取得は失敗する
    listPostDrafts
      .mockResolvedValueOnce(listResponse({ items: many }))
      .mockRejectedValue(new ApiError("API_UNREACHABLE", 0));
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "すべて選択" }));
    await user.click(screen.getByRole("button", { name: "まとめて却下" }));
    const dialog = await screen.findByRole("dialog", { name: "501件を却下する理由" });
    await user.click(within(dialog).getByRole("button", { name: "トーンが違う" }));
    await user.click(within(dialog).getAllByRole("button", { name: "却下する" }).at(-1)!);
    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1));
    expect(toastWarning.mock.calls[0]![0]).toMatch(
      /結果を確認できませんでした。一覧を読み込み直せませんでした。画面を再読み込みして/,
    );
  }, 60_000);

  it("「元に戻す」で返事が来なければ、元に戻せたかを確認できなかったと伝える", async () => {
    const user = userEvent.setup();
    reviewPostDrafts
      .mockImplementationOnce(ok("rejected"))
      .mockImplementationOnce(ok("rejected"))
      .mockRejectedValue(new ApiError("API_UNREACHABLE", 0));
    await rejectAll(user);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("501件を却下しました", expect.anything()),
    );
    const undo = toastSuccess.mock.calls.at(-1)![1].action.onClick as () => void;
    await act(async () => undo());
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0]![0]).toBe(
      "500件は元に戻せたかを確認できませんでした。1件を元に戻せませんでした。一覧を読み込み直しました。それぞれの状態を確かめてから、必要ならもう一度操作してください。",
    );
  }, 60_000);

  it("「元に戻す」が途中で失敗したら、戻せなかった件数を伝える", async () => {
    const user = userEvent.setup();
    reviewPostDrafts
      .mockImplementationOnce(ok("rejected"))
      .mockImplementationOnce(ok("rejected"))
      // 元に戻す（reopen）：1つ目のまとまりは成功、2つ目は確かな失敗
      .mockImplementationOnce(ok("needs_review"))
      .mockRejectedValueOnce(new ApiError("VALIDATION_FAILED", 400, ["items"]));
    await rejectAll(user);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("501件を却下しました", expect.anything()),
    );
    const undo = toastSuccess.mock.calls.at(-1)![1].action.onClick as () => void;
    await act(async () => undo());
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0]![0]).toMatch(/^1件を元に戻せませんでした。/);
    expect(
      reviewPostDrafts.mock.calls.slice(2).map((c) => (c[1] as { action: string }).action),
    ).toEqual(["reopen", "reopen"]);
  }, 60_000);

  it("プロンプトが使えない表示になったAccountから、使えるAccountに切り替えると、使える表示に戻る", async () => {
    const user = userEvent.setup();
    getPrompt.mockImplementation((id: string) =>
      id === "a1"
        ? Promise.reject(new ApiError("BILLING_REQUIRED", 403, ["trial_ended"]))
        : Promise.resolve(promptResponse()),
    );
    function Layout() {
      const [current, setCurrent] = useState(account);
      return (
        <UnsavedChangesProvider>
          <button
            type="button"
            onClick={() => setCurrent({ ...account, id: "a2", username: "other" })}
          >
            切り替え
          </button>
          <Outlet context={{ account: current }} />
        </UnsavedChangesProvider>
      );
    }
    const router = createMemoryRouter(
      [
        {
          path: "/accounts/:accountId",
          element: <Layout />,
          children: [{ path: "stock", element: <StockPage /> }],
        },
      ],
      { initialEntries: ["/accounts/a1/stock"] },
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("今はAIプロンプトを作れません"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "切り替え" }));
    expect(await screen.findByRole("button", { name: "コピー" })).toBeInTheDocument();
    expect(screen.queryByText("今はAIプロンプトを作れません")).not.toBeInTheDocument();
  });
});

describe("005：投稿済みの一覧と自動投稿の知らせ", () => {
  it("投稿済みはタブを開いたときだけ読み、リンクと続きを表示する", async () => {
    const user = userEvent.setup();
    listPublished.mockResolvedValueOnce({ items: [{ id: "p1", body: "公開した本文", publishedAt: "2026-10-06T03:00:00Z", threadsMediaId: "m1", threadsPermalink: "https://www.threads.net/@test/post/1" }], nextCursor: "cursor1" })
      .mockResolvedValueOnce({ items: [{ id: "p2", body: "URLはまだない投稿", publishedAt: "2026-10-05T03:00:00Z", threadsMediaId: "m2", threadsPermalink: null }], nextCursor: null });
    renderPage();
    await screen.findByRole("tab", { name: "投稿済み 0" });
    expect(listPublished).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "投稿済み 0" }));
    expect(await screen.findByText("公開した本文")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Threadsで開く" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Threadsで開く" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText("すべて選択")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "もっと見る" }));
    expect(await screen.findByText("URLを取得中")).toBeInTheDocument();
    expect(screen.getByText("公開した本文")).toBeInTheDocument();
    expect(listPublished).toHaveBeenLastCalledWith("a1", "cursor1");
  });

  it("?tab=published を直接開け、空の状態を表示する", async () => {
    renderPage("/accounts/a1/stock?tab=published");
    expect(await screen.findByText("まだ投稿はありません。承認した下書きは、投稿のスケジュールに沿って投稿されます")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "投稿済み 0" })).toHaveAttribute("data-state", "active");
  });

  it("承認済みが0件の知らせを表示する", async () => {
    getAutoPost.mockResolvedValue({ autoPost: { enabled: true, slotCount: 1, stoppedReason: null }, next: null, approvedCount: 0, daysLeft: null, notices: [{ kind: "no_approved", nextSlotAt: "2026-10-06T12:00:00Z" }] });
    renderPage();
    expect(await screen.findByText(/承認済みの下書きがありません/)).toBeInTheDocument();

  });
});


describe("US2：直前のチェックの理由", () => {
  it("要確認のカードの理由と知らせを出し、閉じると知らせだけを読み直す", async () => {
    const user = userEvent.setup();
    listPostDrafts.mockResolvedValue(listResponse({ items: [draft({ body: "戻された本文", blockedAt: "2026-10-06T03:00:00Z", blockedReason: "ng_word", blockedWords: ["NG"] })] }));
    getAutoPost.mockResolvedValue({ autoPost: { enabled: true, slotCount: 1, stoppedReason: null }, next: null, approvedCount: 0, daysLeft: null, notices: [{ kind: "blocked", count: 1, latestReason: "ng_word", latestWords: ["NG"] }] });
    dismissBlockedNotice.mockImplementation(async () => { getAutoPost.mockResolvedValue({ autoPost: { enabled: true, slotCount: 1, stoppedReason: null }, next: null, approvedCount: 0, daysLeft: null, notices: [] }); });
    renderPage();
    expect(await screen.findByText(/投稿の直前にNGワード（NG）が見つかったため、要確認に戻しました/)).toBeInTheDocument();
    expect(screen.getByText("投稿の直前にNGワード（NG）が見つかったため、1件を要確認に戻しました")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(screen.queryByText("投稿の直前にNGワード（NG）が見つかったため、1件を要確認に戻しました")).not.toBeInTheDocument());
    expect(dismissBlockedNotice).toHaveBeenCalledWith("a1");
    expect(screen.getByText(/投稿の直前にNGワード（NG）が見つかったため、要確認に戻しました/)).toBeInTheDocument();
  });
});


describe("US3：失敗・持ち越し・処理中", () => {
  it("失敗のまとまりは選択の対象外で、もう一度投稿の順に入れられる", async () => {
    const failed = draft({ status: "publish_failed", publishError: "network", publishFailedAt: "2026-10-06T03:00:00Z" });
    listPostDrafts.mockResolvedValue(listResponse({ publishFailed: [failed] }));
    reviewPostDrafts.mockResolvedValue({ updated: [{ ...failed, status: "approved" }], skipped: [], counts: { needsReview: 0, approved: 1, rejected: 0, published: 0, publishFailed: 0 } });
    renderPage("/accounts/a1/stock?tab=approved");
    expect(await screen.findByText("投稿に失敗（1件）")).toBeInTheDocument();
    expect(screen.getByText(/に失敗：Threadsとの通信に失敗しました/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "もう一度投稿の順に入れる" }));
    await waitFor(() => expect(reviewPostDrafts).toHaveBeenCalledWith("a1", expect.objectContaining({ action: "requeue" })));
  });
  it("処理中の操作を無効にし、持ち越しの理由を出す", async () => {
    listPostDrafts.mockResolvedValue(listResponse({ approved: [draft({ id: "busy", status: "publishing" }), draft({ id: "carry", status: "approved", carryover: true })] }));
    renderPage("/accounts/a1/stock?tab=approved");
    expect(await screen.findByText("投稿の処理中")).toBeInTheDocument();
    expect(within(document.getElementById("draft-busy")!).getByRole("checkbox")).toBeDisabled();
    expect(within(document.getElementById("draft-busy")!).getByRole("button", { name: /の操作/ })).toBeDisabled();
    expect(screen.getByText("前回の投稿に失敗したため、次の時刻にもう一度試します")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("すべて選択"));
    expect(screen.getByText("1件を選択中")).toBeInTheDocument();
  });
  it("切断・上限・失敗の知らせと確認先を出す", async () => {
    getAutoPost.mockResolvedValue({ autoPost: { enabled: true, slotCount: 1, stoppedReason: "needs_reconnect" }, next: null, approvedCount: 0, daysLeft: 0, notices: [{ kind: "needs_reconnect" }, { kind: "rate_limited", until: "2026-10-06T15:00:00Z" }, { kind: "publish_failed", count: 2, latestError: "network", latestAt: "2026-10-06T03:00:00Z" }] });
    renderPage();
    expect(await screen.findByRole("button", { name: "再接続" })).toBeInTheDocument();
    expect(screen.getByText(/Threadsの投稿数の上限に達したため/)).toBeInTheDocument();
    expect(screen.getByText("2件の投稿に失敗しました（Threadsとの通信に失敗しました）")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "確認する" })).toHaveAttribute("href", "/accounts/a1/stock?tab=approved#publish-failed");
  });
});


describe("US4：予定と投稿の順", () => {
  it("各カードの予定を出し、先頭以外を次に投稿する操作で移す", async () => {
    const a = draft({ id: "a", body: "先頭", status: "approved" });
    const b = draft({ id: "b", body: "次の本文", status: "approved" });
    const initial = listResponse({ approved: [a, b], schedule: { a: "2026-10-08T03:00:00Z", b: "2026-10-08T12:00:00Z" }, autoPost: { enabled: true, slotCount: 2, stoppedReason: null } });
    listPostDrafts.mockResolvedValue(initial);
    prioritizeDraft.mockImplementation(async () => { listPostDrafts.mockResolvedValue({ ...initial, approved: [b, a], schedule: { b: "2026-10-08T03:00:00Z", a: "2026-10-08T12:00:00Z" } }); return { ...b, version: 2 }; });
    renderPage("/accounts/a1/stock?tab=approved");
    expect(await screen.findByText(/12:00に投稿予定/)).toBeInTheDocument();
    await userEvent.click(within(document.getElementById("draft-a")!).getByRole("button", { name: /の操作/ }));
    expect(screen.queryByRole("menuitem", { name: "次に投稿する" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(document.getElementById("draft-b")!).getByRole("button", { name: /の操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "次に投稿する" }));
    await waitFor(() => expect(prioritizeDraft).toHaveBeenCalledWith("a1", "b", 1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/次の投稿にしました.*12:00/)));
  });
  it("オフでは設定への案内を出す", async () => {
    renderPage("/accounts/a1/stock?tab=approved");
    expect(await screen.findByText("自動投稿はオフです。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "投稿のスケジュールを設定する" })).toHaveAttribute("href", "/accounts/a1/settings");
  });
});

describe("005：画面を開いた後に投稿の処理が始まる", () => {
  it("編集の保存がDRAFT_PUBLISHINGなら、知らせて一覧を読み直す", async () => {
    listPostDrafts.mockResolvedValue(listResponse({ approved: [draft({ status: "approved" })] }));
    updatePostDraft.mockRejectedValue(new ApiError("DRAFT_PUBLISHING", 409));
    renderPage("/accounts/a1/stock?tab=approved");
    await userEvent.click(await screen.findByRole("button", { name: "「下書きの本文」の操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "編集" }));
    const dialog = await screen.findByRole("dialog", { name: "下書きを編集" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /本文/ }), "を直す");
    await userEvent.click(within(dialog).getAllByRole("button", { name: "保存" }).at(-1)!);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("投稿の処理中です。少し待ってからもう一度お試しください。"));
    await waitFor(() => expect(listPostDrafts.mock.calls.length).toBeGreaterThan(1));
  });
  it("要確認に戻す操作がPUBLISHINGで飛ばされたら、理由を知らせる", async () => {
    const d = draft({ status: "approved" });
    listPostDrafts.mockResolvedValue(listResponse({ approved: [d] }));
    reviewPostDrafts.mockResolvedValue({ updated: [], skipped: [{ id: d.id, reason: "PUBLISHING" }], counts: { needsReview: 0, approved: 1, rejected: 0, published: 0, publishFailed: 0 } });
    renderPage("/accounts/a1/stock?tab=approved");
    await userEvent.click(await screen.findByRole("button", { name: "「下書きの本文」の操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "要確認に戻す" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("投稿の処理中です。少し待ってからもう一度お試しください。"));
  });
});

// ---- チーム運用：承認の操作ができない人の出し分け（specs/008 FR-041・FR-002a、contracts/ui-routes.md「投稿ストック」）----
describe("投稿ストック（承認の権限がない人）", () => {
  it("要確認に「オーナーの確認待ち」と出し、承認・却下・選択・まとめての操作を出さない。案内を出す", async () => {
    accountAccess.mockResolvedValue(EDITOR_ACCESS);
    listPostDrafts.mockResolvedValue(listResponse({ items: [draft({ id: "d1", body: "編集者が作った案" })] }));
    renderPage();
    expect(await screen.findByText("オーナーの確認待ち")).toBeInTheDocument();
    expect(
      screen.getByText("承認と却下は、オーナー（鈴木 花子）さんが行います。あなたは投稿の案を登録したり、直したりできます。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /を承認$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /を却下$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /を選択$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("すべて選択")).not.toBeInTheDocument();
    // 「⋯」には編集と削除がある
    await userEvent.setup().click(screen.getByRole("button", { name: "「編集者が作った案」の操作" }));
    expect(await screen.findByRole("menuitem", { name: "編集" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "削除" })).toBeInTheDocument();
    accountAccess.mockResolvedValue(OWNER_ACCESS);
  });

  it("承認済みには「次に投稿する」「要確認に戻す」を出さず、却下の案には操作を出さない", async () => {
    accountAccess.mockResolvedValue(EDITOR_ACCESS);
    listPostDrafts.mockResolvedValue(
      listResponse({
        approved: [draft({ id: "a1", status: "approved", body: "承認済み1" }), draft({ id: "a2", status: "approved", body: "承認済み2" })],
        rejected: [draft({ id: "r1", status: "rejected", body: "却下の案" })],
      }),
    );
    const user = userEvent.setup();
    renderPage("/accounts/a1/stock?tab=approved");
    await user.click(await screen.findByRole("button", { name: "「承認済み2」の操作" }));
    expect(await screen.findByRole("menuitem", { name: "編集" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "次に投稿する" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "要確認に戻す" })).not.toBeInTheDocument();
    accountAccess.mockResolvedValue(OWNER_ACCESS);
  });
});

describe("投稿ストック（作った人・直した人。specs/008 FR-053）", () => {
  it("チームがあるAccountでは名前と時刻を出し、個人運用では出さない", async () => {
    const withAuthors = listResponse({
      items: [draft({ id: "d1", body: "名前つきの案", createdBy: "u1", editedBy: "u2", editedAt: "2026-10-09T06:10:00.000Z" })],
    });
    withAuthors.people = { u1: "高橋 涼", u2: "佐藤 美咲" };
    listPostDrafts.mockResolvedValue(withAuthors);
    accountAccess.mockResolvedValue({ ...OWNER_ACCESS, hasTeam: true });
    renderPage();
    expect(await screen.findByText(/作成 高橋 涼 · /)).toBeInTheDocument();
    expect(screen.getByText(/編集 佐藤 美咲/)).toBeInTheDocument();
    accountAccess.mockResolvedValue(OWNER_ACCESS);
  });

  it("個人運用（hasTeam = false）では、名前を出さない", async () => {
    const withAuthors = listResponse({ items: [draft({ id: "d1", body: "個人の案", createdBy: "u1" })] });
    withAuthors.people = { u1: "たくみ" };
    listPostDrafts.mockResolvedValue(withAuthors);
    renderPage();
    expect(await screen.findByText("個人の案")).toBeInTheDocument();
    expect(screen.queryByText(/作成 たくみ/)).not.toBeInTheDocument();
  });
});
