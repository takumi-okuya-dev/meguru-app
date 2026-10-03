// 投稿ストックの画面（specs/003-prompt-bulk-register US1〜US3、contracts/ui-routes.md「投稿ストックの画面」）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, DraftBatchResult, PostDraft, PromptResponse } from "@threads-grower/shared";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listPostDrafts = vi.fn();
const getPrompt = vi.fn();
const putPromptSettings = vi.fn();
const createDraftBatch = vi.fn();
const deleteDraftBatch = vi.fn();
const updatePostDraft = vi.fn();
const deletePostDrafts = vi.fn();
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
    },
  };
});
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

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
    summary: { strategyFilledCount: 11, promotionCount: 1, referencePostCount: 3, recentDraftCount: 0, length: 100, ...overrides },
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
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  };
}

function batchResult(drafts: PostDraft[], overrides: Partial<DraftBatchResult> = {}): DraftBatchResult {
  return { batchId: "b1", draftCount: drafts.length, delimiterFound: true, overLimitCount: 0, drafts, ...overrides };
}

function listResponse(overrides: { items?: PostDraft[]; canGeneratePrompt?: boolean; promptPostCount?: number } = {}) {
  return { items: [], limit: 500, canGeneratePrompt: true, promptPostCount: 30, ...overrides };
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
  for (const fn of [listPostDrafts, getPrompt, putPromptSettings, createDraftBatch, deleteDraftBatch, updatePostDraft, deletePostDrafts]) {
    fn.mockReset();
  }
  toastSuccess.mockReset();
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
    listPostDrafts.mockResolvedValue({ ...listResponse({ items: [draft()] }), limit: 1 });
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

  it("下書きを選ぶと貼り付け欄の位置に選択のバーが出て、確認のうえ選んだIDで削除する（FR-020）", async () => {
    const user = userEvent.setup();
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
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("2件の下書きを削除しますか？")).toBeInTheDocument();
    expect(within(dialog).getByText("元に戻せません。")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    expect(deletePostDrafts).toHaveBeenCalledWith("a1", ["d1", "d3"]);
    await waitFor(() => expect(screen.queryByText("1件目の下書き")).not.toBeInTheDocument());
    expect(screen.queryByText(/件を選択中/)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "AIの返信を貼り付ける欄" })).toBeInTheDocument();
  });

  it("「すべて選択」と「選択を解除」", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "すべて選択" }));
    expect(screen.getByText("3件を選択中")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "選択を解除" }));
    expect(screen.queryByText(/件を選択中/)).not.toBeInTheDocument();
  });

  it("「⋯」の「削除」で1件を確認のうえ削除する", async () => {
    const user = userEvent.setup();
    deletePostDrafts.mockResolvedValue({ deletedCount: 1 });
    renderPage();
    await user.click(await screen.findByRole("button", { name: "「2件目の下書き」の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "削除" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("この下書きを削除しますか？")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    expect(deletePostDrafts).toHaveBeenCalledWith("a1", ["d2"]);
  });

  it("「⋯」の「編集」で本文を直して保存すると一覧に反映される（FR-019）", async () => {
    const user = userEvent.setup();
    updatePostDraft.mockImplementation(async (_a: string, id: string, req: { body: string }) => {
      const updated = { ...items[0]!, id, body: req.body, version: 2 };
      listPostDrafts.mockResolvedValue(listResponse({ items: [updated, items[1]!, items[2]!] }));
      return updated;
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
