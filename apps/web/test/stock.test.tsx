// 投稿ストックの画面（specs/003-prompt-bulk-register US1〜US3、contracts/ui-routes.md「投稿ストックの画面」）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, DraftBatchResult, PostDraft, PostDraftList, PromptResponse } from "@threads-grower/shared";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listPostDrafts = vi.fn();
const getPrompt = vi.fn();
const putPromptSettings = vi.fn();
const createDraftBatch = vi.fn();
const deleteDraftBatch = vi.fn();
const updatePostDraft = vi.fn();
const deletePostDrafts = vi.fn();
const reviewPostDrafts = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listPostDrafts,
      getPrompt,
      putPromptSettings,
      createDraftBatch,
      deleteDraftBatch,
      updatePostDraft,
      deletePostDrafts,
      reviewPostDrafts,
    },
  };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, warning: toastWarning, dismiss: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { StockPage } = await import("@/pages/stock");

const account: AccountSummary = {
  id: "a1",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  plan: "auto-grower",
  connectionStatus: "connected",
  lastUsedAt: null,
};

const PROMPT = "以下の情報をもとに、Threadsに投稿する文章を30件作ってください。";

function promptResponse(overrides: Partial<PromptResponse["summary"]> = {}, count = 30): PromptResponse {
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
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  };
}

function batchResult(drafts: PostDraft[], overrides: Partial<DraftBatchResult> = {}): DraftBatchResult {
  return { batchId: "b1", draftCount: drafts.length, delimiterFound: true, overLimitCount: 0, drafts, ...overrides };
}

function listResponse(
  overrides: {
    items?: PostDraft[];
    approved?: PostDraft[];
    rejected?: PostDraft[];
    ngWords?: PostDraftList["ngWords"];
    canGeneratePrompt?: boolean;
    promptPostCount?: number;
  } = {},
): PostDraftList {
  const { items = [], approved = [], rejected = [], ngWords = [], ...rest } = overrides;
  return {
    needsReview: items,
    approved,
    rejected,
    counts: { needsReview: items.length, approved: approved.length, rejected: rejected.length },
    limits: { needsReview: 500, approved: 500 },
    ngWords,
    canGeneratePrompt: true,
    promptPostCount: 30,
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
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
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
  ]) {
    fn.mockReset();
  }
  toastSuccess.mockReset();
  toastError.mockReset();
  toastWarning.mockReset();
  listPostDrafts.mockResolvedValue(listResponse());
  getPrompt.mockImplementation((_id: string, count?: number) => Promise.resolve(promptResponse({}, count ?? 30)));
});

describe("プロンプトのカード（US1）", () => {
  it("要約が出て、「コピー」で全文がクリップボードに渡り、トーストが出る", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderPage();
    expect(await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "コピー" }));
    expect(writeText).toHaveBeenCalledWith(PROMPT);
    expect(toastSuccess).toHaveBeenCalledWith("コピーしました。ChatGPTやClaudeに貼り付けて送ってください");
  });

  it("コピーの失敗：全文の欄が開いて全選択され、案内が出る（research.md R13）", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    renderPage();
    await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映");
    await user.click(screen.getByRole("button", { name: "コピー" }));
    expect(await screen.findByText("自動でコピーできませんでした。選択された文字を手でコピーしてください")).toBeInTheDocument();
    const area = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "プロンプトの全文" });
    await waitFor(() => expect([area.selectionStart, area.selectionEnd]).toEqual([0, PROMPT.length]));
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
    putPromptSettings.mockResolvedValue({ postCount: 10 });
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "作る件数" });
    expect(input).toHaveValue(30);
    await user.clear(input);
    await user.type(input, "10");
    await waitFor(() => expect(putPromptSettings).toHaveBeenCalledWith("a1", 10), { timeout: 2000 });
    expect(putPromptSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getPrompt).toHaveBeenCalledWith("a1", 10));
  });

  it("保存中に件数を変えても並行して保存せず、終わってから最新の件数を保存する（Codexレビュー）", async () => {
    const user = userEvent.setup();
    let resolveFirst: (v: { postCount: number }) => void = () => {};
    putPromptSettings.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
    putPromptSettings.mockImplementation(async (_id: string, n: number) => ({ postCount: n }));
    renderPage();
    const input = await screen.findByRole("spinbutton", { name: "作る件数" });
    await user.clear(input);
    await user.type(input, "10");
    await waitFor(() => expect(putPromptSettings).toHaveBeenCalledWith("a1", 10), { timeout: 2000 });
    await user.clear(input);
    await user.type(input, "20");
    await waitFor(() => expect(getPrompt).toHaveBeenCalledWith("a1", 20), { timeout: 2000 });
    expect(putPromptSettings).toHaveBeenCalledTimes(1);
    act(() => resolveFirst({ postCount: 10 }));
    await waitFor(() => expect(putPromptSettings).toHaveBeenCalledTimes(2));
    expect(putPromptSettings).toHaveBeenLastCalledWith("a1", 20);
  });

  it("件数の保存に失敗したら、案内と「もう一度保存」を出し、押すまで送り直さない（Codexレビュー）", async () => {
    const user = userEvent.setup();
    putPromptSettings.mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0));
    putPromptSettings.mockResolvedValueOnce({ postCount: 10 });
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
    await waitFor(() => expect(screen.queryByRole("button", { name: "もう一度保存" })).not.toBeInTheDocument());
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

  it("プラン1の表示：canGeneratePrompt が false なら案内に変わり、getPrompt を呼ばない（FR-024）", async () => {
    listPostDrafts.mockResolvedValue(listResponse({ canGeneratePrompt: false }));
    renderPage();
    expect(await screen.findByText("AIプロンプトの生成はプラン2以上で使えます")).toBeInTheDocument();
    expect(screen.getByText(/「@@@」だけの行で区切って下の欄に貼り付ければ、まとめて登録できます/)).toBeInTheDocument();
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
    expect(await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映")).toBeInTheDocument();
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
    const drafts = [draft({ id: "d1", body: "1件目" }), draft({ id: "d2", position: 1, body: "2件目" })];
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
    expect(createDraftBatch).toHaveBeenCalledWith("a1", { clientRequestId: expect.any(String), text: "1件目\n@@@\n2件目" });
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
    const items = [draft({ id: "d1", body: "1件目" }), draft({ id: "d2", position: 1, body: "2件目" })];
    listPostDrafts.mockResolvedValue({ ...listResponse({ items }), limits: { needsReview: 2, approved: 500 } });
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
    expect(deletePostDrafts.mock.invocationCallOrder[0]!).toBeLessThan(createDraftBatch.mock.invocationCallOrder[0]!);
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
    const [first, second] = createDraftBatch.mock.calls.map((c) => (c[1] as { clientRequestId: string }).clientRequestId);
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
    createDraftBatch.mockResolvedValue(batchResult([draft()], { delimiterFound: false, overLimitCount: 1 }));
    renderPage();
    await screen.findByText(/まだ下書きがありません/);
    await paste(user, "区切りのない投稿");
    await user.click(sendButton());
    expect(await screen.findByText("区切り（@@@）が見つからなかったため、1件として登録しました")).toBeInTheDocument();
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
      await screen.findByText("要確認の下書きが上限（500件）に達しています。不要な下書きを削除してから登録してください。"),
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
    expect(await screen.findByText(/^12件目が2,000文字を超えています。一度に登録できるのは/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "もう一度送る" })).not.toBeInTheDocument();
  });

  it("要確認が上限に達していると、一覧の上に案内が出て送るボタンが無効になる", async () => {
    const user = userEvent.setup();
    listPostDrafts.mockResolvedValue({ ...listResponse({ items: [draft()] }), limits: { needsReview: 1, approved: 500 } });
    renderPage();
    expect(await screen.findByText(/要確認の下書きが上限（500件）に達しています/)).toBeInTheDocument();
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

  it("「投稿をつくる」から来たら、欄にフォーカスが当たる（FR-021）", async () => {
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
      { initialEntries: [{ pathname: "/accounts/a1/stock", state: { focusComposer: true } }] },
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
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
      const opts = toastSuccess.mock.lastCall?.[1] as { action: { label: string; onClick: () => void } };
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
      expect(screen.queryByRole("textbox", { name: "AIの返信を貼り付ける欄" })).not.toBeInTheDocument();

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
    expect(updatePostDraft).toHaveBeenCalledWith("a1", "d1", { body: "直した下書き", expectedVersion: 1 });
    expect(await screen.findByText("直した下書き")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("編集の保存で 409 なら競合のダイアログが出る", async () => {
    const user = userEvent.setup();
    updatePostDraft.mockRejectedValue(
      new ApiError("STALE_UPDATE", 409, [], { ...items[0]!, body: "他で直した", version: 2, updatedAt: "2026-10-03T01:00:00.000Z" }),
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
  const reviewed = (d: PostDraft, status: PostDraft["status"], extra: Partial<PostDraft> = {}): PostDraft => ({
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
  const approvedDraft = reviewed(draft({ id: "p1", body: "承認した投稿", batchId: "b0" }), "approved");
  const rejectedDraft = reviewed(draft({ id: "r1", body: "却下した投稿", batchId: "b0", position: 1 }), "rejected", {
    rejectReasons: ["tone"],
    rejectNote: "語尾がきつい",
  });
  const ngWords = [{ id: "w1", word: "絶対", normalized: "絶対", createdAt: "2026-10-04T00:00:00.000Z" }];

  beforeEach(() => {
    listPostDrafts.mockResolvedValue(listResponse({ items: needs, approved: [approvedDraft], rejected: [rejectedDraft], ngWords }));
    reviewPostDrafts.mockImplementation(async (_a: string, req: { action: string; items: { id: string }[] }) => {
      const all = [...needs, approvedDraft, rejectedDraft];
      const target = { approve: "approved", reject: "rejected", reopen: "needs_review" }[req.action] as PostDraft["status"];
      return {
        updated: req.items.map((i) => reviewed(all.find((d) => d.id === i.id)!, target)),
        skipped: [],
        counts: { needsReview: 2, approved: 2, rejected: 1 },
      };
    });
  });

  it("3つのタブに件数が出て、?tab=approved で承認済みのタブが開く（FR-001）", async () => {
    renderPage("/accounts/a1/stock?tab=approved");
    expect(await screen.findByRole("tab", { name: "要確認 3" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "却下 1" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "承認済み 1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("承認した投稿")).toBeInTheDocument();
    expect(screen.getByText("承認した投稿は、自動投稿の設定ができると順に投稿されます")).toBeInTheDocument();
  });

  it("「承認」で状態を変え、トーストの「元に戻す」で要確認に戻す（FR-002・FR-008）", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「1件目の下書き」を承認" }));
    expect(reviewPostDrafts).toHaveBeenCalledWith("a1", { action: "approve", items: [{ id: "n1", expectedVersion: 1 }] });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("承認しました", expect.anything()));
    const undo = toastSuccess.mock.calls.at(-1)![1].action.onClick as () => void;
    await act(async () => undo());
    expect(reviewPostDrafts).toHaveBeenLastCalledWith("a1", { action: "reopen", items: [{ id: "n1", expectedVersion: 2 }] });
  });

  it("却下理由：候補が6つあり、空なら確定できず、選ぶと理由つきで却下する（FR-003）", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「1件目の下書き」を却下" }));
    const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
    const chips = within(within(dialog).getByRole("group", { name: "よくある理由" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual([
      "似た投稿がある",
      "トーンが違う",
      "内容が薄い",
      "事実と違う",
      "宣伝っぽすぎる",
      "規約に触れそう",
    ]);
    expect(within(dialog).getByText("理由を1つ以上選ぶか、書いてください")).toBeInTheDocument();
    for (const b of within(dialog).getAllByRole("button", { name: "却下する" })) expect(b).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "トーンが違う" }));
    await user.click(within(dialog).getAllByRole("button", { name: "却下する" }).at(-1)!);
    expect(reviewPostDrafts).toHaveBeenCalledWith("a1", {
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
    await waitFor(() =>
      expect(toastWarning).toHaveBeenCalledWith("2件を承認しました。1件は承認できませんでした（NGワード 1件）", expect.anything()),
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
    expect(within(bar).queryByRole("button", { name: "選んだ下書きを削除" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "却下 1" }));
    await user.click(await screen.findByRole("checkbox", { name: "「却下した投稿」を選択" }));
    bar = screen.getByRole("toolbar", { name: "選んだ下書きの操作" });
    expect(within(bar).getByRole("button", { name: "選んだ下書きを削除" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "要確認に戻す" })).toBeInTheDocument();
  });

  it("NGワードを含む下書きは「承認」が押せず、理由が出る（FR-005）", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "「絶対に伸びる」を承認" })).toBeDisabled();
    expect(screen.getByText("NGワードを含むため承認できません。本文を直すか却下してください")).toBeInTheDocument();
  });

  it("承認済みの「編集」で案内が出て、要確認に戻ったら知らせる（FR-007）", async () => {
    const user = userEvent.setup();
    updatePostDraft.mockResolvedValue({ draft: reviewed(approvedDraft, "needs_review"), reopened: true });
    renderPage("/accounts/a1/stock?tab=approved");
    await user.click(await screen.findByRole("button", { name: "「承認した投稿」の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "編集" }));
    const dialog = await screen.findByRole("dialog", { name: "下書きを編集" });
    expect(within(dialog).getByText("保存すると要確認に戻り、もう一度承認が必要になります")).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /本文/ }), "！");
    await user.click(within(dialog).getAllByRole("button", { name: "保存" }).at(-1)!);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("直したので、要確認に戻しました。もう一度承認してください"));
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
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("他の場所で更新されています。最新の内容を表示しました。"));
  });
});

describe("NGワードのラベルと強調（004 US2、FR-016）", () => {
  it("要確認の下書きに「NGワード：絶対」が出て、本文の「絶対」が強調される", async () => {
    listPostDrafts.mockResolvedValue(
      listResponse({
        items: [draft({ id: "n1", body: "絶対に伸びる方法" })],
        ngWords: [{ id: "w1", word: "絶対", normalized: "絶対", createdAt: "2026-10-04T00:00:00.000Z" }],
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
        ngWords: [{ id: "w1", word: "絶対", normalized: "絶対", createdAt: "2026-10-04T00:00:00.000Z" }],
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
  const other = draft({ id: "n2", body: "仕事の段取りを前日の夜に決めておくと、次の朝の迷いがぐっと減る。", position: 1 });

  beforeEach(() => {
    listPostDrafts.mockResolvedValue(listResponse({ items: [twin, other], approved: [approvedTwin] }));
    reviewPostDrafts.mockResolvedValue({ updated: [], skipped: [], counts: { needsReview: 2, approved: 1, rejected: 0 } });
  });

  it("承認済みとほぼ同じ下書きは注意の色の類似度と「似ている投稿があります」。違う投稿は低い類似度だけ", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /^類似度 9\d%・似ている投稿があります$/ })).toBeInTheDocument();
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
    expect(await screen.findByRole("tab", { name: /承認済み/ })).toHaveAttribute("aria-selected", "true");
  });

  it("似ている下書きの却下で「似た投稿がある」が最初から選ばれている。80%以上でも「承認」は押せる", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: /似ている投稿があります/ });
    expect(screen.getByRole("button", { name: `「${twin.body.slice(0, 20)}…」を承認` })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: `「${twin.body.slice(0, 20)}…」を却下` }));
    const dialog = await screen.findByRole("dialog", { name: "却下の理由" });
    expect(within(dialog).getByRole("button", { name: "似た投稿がある" })).toHaveAttribute("aria-pressed", "true");
  });

  it("まとめて却下では、選んだうち1件でも似ていれば最初から選ばれている", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: /似ている投稿があります/ });
    await user.click(screen.getByRole("checkbox", { name: "すべて選択" }));
    await user.click(screen.getByRole("button", { name: "まとめて却下" }));
    const dialog = await screen.findByRole("dialog", { name: "2件を却下する理由" });
    expect(within(dialog).getByRole("button", { name: "似た投稿がある" })).toHaveAttribute("aria-pressed", "true");
  });
});
