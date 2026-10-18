// 「投稿をつくる」の画面（specs/014-strategy-guidance US15、FR-160〜FR-162・FR-165、contracts/ui-routes.md「投稿をつくる」）。
// プロンプトのカードと貼り付け欄のテストは、003・004の投稿ストックのテストから移した。
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DraftBatchResult } from "@threads-grower/shared";
import { useState } from "react";
import { Link, Outlet } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_ACCESS, OWNER_ACCESS } from "./helpers/access";
import {
  PROMPT,
  account,
  batchResult,
  draft,
  listResponse,
  promptResponse,
  renderAccountRoutes,
} from "./helpers/stock";

const listPostDrafts = vi.fn();
const getPrompt = vi.fn();
const putPromptSettings = vi.fn();
const createDraftBatch = vi.fn();
const deleteDraftBatch = vi.fn();
const accountAccess = vi.fn(async () => OWNER_ACCESS);

vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { ...actual.api, accountAccess, listPostDrafts, getPrompt, putPromptSettings, createDraftBatch, deleteDraftBatch },
  };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, warning: vi.fn(), info: toastInfo, dismiss: vi.fn() },
}));

const { ApiError } = await import("@/lib/api-client");
const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { CreatePage } = await import("@/pages/create");

const ROUTES = [
  { index: true, element: <p>ホームの中身</p> },
  { path: "strategy", element: <p>課題の中身</p> },
  { path: "create", element: <CreatePage /> },
  { path: "stock", element: <p>投稿ストックの中身</p> },
];

function renderPage(initial: string | { pathname: string; state?: unknown } = "/accounts/a1/create") {
  return renderAccountRoutes(
    ROUTES,
    initial,
    <>
      <Link to="/accounts/a1">ホームへ</Link>
      <Link to="/accounts/a1/create">投稿をつくるへ</Link>
      <UnsavedChangesProvider>
        <Outlet context={{ account }} />
      </UnsavedChangesProvider>
    </>,
  );
}

const composer = () => screen.getByRole("textbox", { name: "AIの返信を貼り付ける欄" });
const findComposer = () => screen.findByRole("textbox", { name: "AIの返信を貼り付ける欄" });
const sendButton = () => screen.getByRole("button", { name: "投稿ストックに登録する" });

async function paste(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(composer());
  await user.paste(text);
}

beforeEach(() => {
  for (const fn of [listPostDrafts, getPrompt, putPromptSettings, createDraftBatch, deleteDraftBatch]) fn.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  toastInfo.mockReset();
  accountAccess.mockResolvedValue(OWNER_ACCESS);
  listPostDrafts.mockResolvedValue(listResponse());
  getPrompt.mockImplementation((_id: string, count?: number) => Promise.resolve(promptResponse({}, count ?? 30)));
});

describe("「投稿をつくる」の画面の並び（FR-161）", () => {
  it("上部バー「投稿をつくる」、プロンプトのカード、貼り付け欄（見出しつき）の順。一覧は置かない", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "投稿をつくる" })).toBeInTheDocument();
    const prompt = await screen.findByRole("region", { name: "プロンプト" });
    const pasteArea = screen.getByRole("region", { name: "AIの答えを貼り付けて、投稿ストックに登録する" });
    expect(screen.getByRole("heading", { name: "AIの答えを貼り付けて、投稿ストックに登録する" })).toBeInTheDocument();
    expect(prompt.compareDocumentPosition(pasteArea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /要確認/ })).not.toBeInTheDocument();
  });
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
    expect(screen.getByRole("heading", { name: "投稿をつくる" })).toBeInTheDocument();
    await user.click(retry);
    expect(
      await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映"),
    ).toBeInTheDocument();
  });

  it("「投稿をつくる」の画面を開くたびに、プロンプトを取り直す（FR-007）", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映");
    expect(getPrompt).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("link", { name: "ホームへ" }));
    await screen.findByText("ホームの中身");
    await user.click(screen.getByRole("link", { name: "投稿をつくるへ" }));
    await screen.findByText("課題 11/16・宣伝の対象 1件・参考投稿 3件を反映");
    await waitFor(() => expect(getPrompt).toHaveBeenCalledTimes(2));
  });
});


describe("貼り付け欄（003 US2、014 FR-162）", () => {
  it("登録すると「〇件を投稿ストックに登録しました」「投稿ストックで確かめる」が出て欄が空になり、「取り消す」で欄に内容が戻る", async () => {
    const user = userEvent.setup();
    const drafts = [draft({ id: "d1", body: "1件目" }), draft({ id: "d2", position: 1, body: "2件目" })];
    createDraftBatch.mockResolvedValue(batchResult(drafts));
    deleteDraftBatch.mockResolvedValue({ deletedCount: 2 });
    const router = renderPage();
    await findComposer();
    await paste(user, "1件目\n@@@\n2件目");
    await user.click(sendButton());
    expect(await screen.findByText("2件を投稿ストックに登録しました")).toBeInTheDocument();
    expect(createDraftBatch).toHaveBeenCalledWith("a1", { clientRequestId: expect.any(String), text: "1件目\n@@@\n2件目" });
    expect(composer()).toHaveValue("");
    expect(screen.getByRole("link", { name: "投稿ストックで確かめる" })).toHaveAttribute("href", "/accounts/a1/stock");

    await user.click(screen.getByRole("button", { name: "取り消す" }));
    expect(deleteDraftBatch).toHaveBeenCalledWith("a1", "b1");
    await waitFor(() => expect(composer()).toHaveValue("1件目\n@@@\n2件目"));
    expect(toastSuccess).toHaveBeenCalledWith("2件の登録を取り消しました");
    expect(screen.queryByText("2件を投稿ストックに登録しました")).not.toBeInTheDocument();

    await user.click(sendButton());
    await user.click(await screen.findByRole("link", { name: "投稿ストックで確かめる" }));
    expect(router.state.location.pathname).toBe("/accounts/a1/stock");
  });

  it("次の送信が失敗しても、前回の登録の案内（「取り消す」）は残る（Codexレビュー）", async () => {
    const user = userEvent.setup();
    createDraftBatch.mockResolvedValueOnce(batchResult([draft()]));
    createDraftBatch.mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0));
    renderPage();
    await findComposer();
    await paste(user, "1回目");
    await user.click(sendButton());
    await screen.findByText("1件を投稿ストックに登録しました");
    await paste(user, "2回目");
    await user.click(sendButton());
    await screen.findByRole("button", { name: "もう一度送る" });
    expect(screen.getByText("1件を投稿ストックに登録しました")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取り消す" })).toBeInTheDocument();
  });

  it("送信中は送るボタンと欄が無効になり、失敗して送り直すときは同じ clientRequestId を送る（FR-015）", async () => {
    const user = userEvent.setup();
    let reject: (e: unknown) => void = () => {};
    createDraftBatch.mockImplementationOnce(() => new Promise((_, r) => (reject = r)));
    createDraftBatch.mockResolvedValueOnce(batchResult([draft()]));
    renderPage();
    await findComposer();
    await paste(user, "A");
    await user.click(sendButton());
    await waitFor(() => expect(composer()).toBeDisabled());
    expect(sendButton()).toBeDisabled();
    reject(new ApiError("API_UNREACHABLE", 0));
    await user.click(await screen.findByRole("button", { name: "もう一度送る" }));
    await screen.findByText("1件を投稿ストックに登録しました");
    const [first, second] = createDraftBatch.mock.calls.map(
      (c) => (c[1] as { clientRequestId: string }).clientRequestId,
    );
    expect(second).toBe(first);
  });

  it("空・空白だけのときは送れない。51件分を貼ると、送らずに上限の案内が出る（FR-014）", async () => {
    const user = userEvent.setup();
    renderPage();
    await findComposer();
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
    await findComposer();
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
    await findComposer();
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
    await findComposer();
    await paste(user, "A");
    await user.click(sendButton());
    expect(
      await screen.findByText(/^12件目が2,000文字を超えています。一度に登録できるのは/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "もう一度送る" })).not.toBeInTheDocument();
  });

  it("要確認が上限に達していると、案内が出て送るボタンが無効になる", async () => {
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
    await findComposer();
    await paste(user, "書きかけ");
    await user.click(screen.getByRole("link", { name: "ホームへ" }));
    expect(await screen.findByText("保存していない変更があります")).toBeInTheDocument();
  });
});

describe("開いたときの初めのフォーカス（004 Clarifications 2026-10-05、014 T063）", () => {
  it("プロンプトを作れるときは、プロンプトのカードの「コピー」にフォーカスが当たる", async () => {
    renderPage();
    const copy = await screen.findByRole("button", { name: "コピー" });
    await waitFor(() => expect(copy).toHaveFocus());
    expect(composer()).not.toHaveFocus();
  });

  it("プロンプトを作れないとき（読むだけ）は、貼り付け欄にフォーカスが当たる（003 FR-021）", async () => {
    listPostDrafts.mockResolvedValue(listResponse({ canGeneratePrompt: false }));
    renderPage();
    await waitFor(() => expect(composer()).toHaveFocus());
  });

  it("プロンプトの読み込みに失敗しても、「再読み込み」で「コピー」が出た時点でフォーカスする", async () => {
    const user = userEvent.setup();
    getPrompt.mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "再読み込み" }));
    const copy = await screen.findByRole("button", { name: "コピー" });
    await waitFor(() => expect(copy).toHaveFocus());
  });

  it("画面を開いた後にプロンプトが使えなくなったら、貼り付け欄にフォーカスする", async () => {
    getPrompt.mockRejectedValue(new ApiError("BILLING_REQUIRED", 403, ["trial_ended"]));
    renderPage();
    expect(await screen.findByText("今はAIプロンプトを作れません")).toBeInTheDocument();
    await waitFor(() => expect(composer()).toHaveFocus());
  });

  it("再訪で読み込み直しが失敗しても、「再読み込み」で成功した時点で「コピー」にフォーカスする", async () => {
    const user = userEvent.setup();
    const router = renderPage();
    await screen.findByRole("button", { name: "コピー" });
    await act(() => router.navigate("/accounts/a1"));
    await screen.findByText("ホームの中身");
    // キャッシュがある状態で、読み込み直しだけが失敗する
    getPrompt.mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0));
    await act(() => router.navigate("/accounts/a1/create"));
    await user.click(await screen.findByRole("button", { name: "再読み込み" }));
    const copy = await screen.findByRole("button", { name: "コピー" });
    await waitFor(() => expect(copy).toHaveFocus());
  });

  it("読むだけで送信中にもう一度「投稿をつくる」を開いても、送信が終わって欄が使えるようになった時点でフォーカスする", async () => {
    const user = userEvent.setup();
    listPostDrafts.mockResolvedValue(listResponse({ canGeneratePrompt: false }));
    let finish: (v: DraftBatchResult) => void = () => {};
    createDraftBatch.mockImplementation(() => new Promise<DraftBatchResult>((r) => (finish = r)));
    const router = renderPage();
    await waitFor(() => expect(composer()).toHaveFocus());
    await user.type(composer(), "A");
    await user.click(sendButton());
    await waitFor(() => expect(composer()).toBeDisabled());
    await act(() => router.navigate("/accounts/a1/create", { state: { again: true } }));
    expect(composer()).not.toHaveFocus();
    await act(async () => finish(batchResult([draft({ id: "n1", body: "A" })])));
    await waitFor(() => expect(composer()).toHaveFocus());
  });
});

describe("アカウントの切り替え（PR #5 のCodexレビュー）", () => {
  it("プロンプトが使えない表示になったAccountから、使えるAccountに切り替えると、使える表示に戻る", async () => {
    const user = userEvent.setup();
    getPrompt.mockImplementation((id: string) =>
      id === "a1" ? Promise.reject(new ApiError("BILLING_REQUIRED", 403, ["trial_ended"])) : Promise.resolve(promptResponse()),
    );
    function Layout() {
      const [current, setCurrent] = useState(account);
      return (
        <UnsavedChangesProvider>
          <button type="button" onClick={() => setCurrent({ ...account, id: "a2", username: "other" })}>
            切り替え
          </button>
          <Outlet context={{ account: current }} />
        </UnsavedChangesProvider>
      );
    }
    renderAccountRoutes(ROUTES, "/accounts/a1/create", <Layout />);
    expect(await screen.findByText("今はAIプロンプトを作れません")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "切り替え" }));
    expect(await screen.findByRole("button", { name: "コピー" })).toBeInTheDocument();
    expect(screen.queryByText("今はAIプロンプトを作れません")).not.toBeInTheDocument();
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
