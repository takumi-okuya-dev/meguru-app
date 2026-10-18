// US9：検索するキーワードの案をAIに出してもらう（specs/014-strategy-guidance FR-090〜FR-093）
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ResearchKeyword } from "@threads-grower/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderResearchPage } from "./helpers/research";

const listReferencePosts = vi.fn();
const listResearchKeywords = vi.fn();
const getKeywordIdeaPrompt = vi.fn();
const createKeywordsBatch = vi.fn();
const toastSuccess = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { ...actual.api, listReferencePosts, listResearchKeywords, getKeywordIdeaPrompt, createKeywordsBatch },
  };
});
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { ResearchPage } = await import("@/pages/research");

const meta = { version: 1, createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" };
const kw = (id: string, keyword: string, purpose = ""): ResearchKeyword => ({ id, keyword, purpose, ...meta });

function renderKeywords() {
  return renderResearchPage(ResearchPage, "/accounts/a1/research?tab=keywords");
}

beforeEach(() => {
  listReferencePosts.mockReset().mockResolvedValue({ items: [], limit: 200, canEdit: true });
  listResearchKeywords.mockReset().mockResolvedValue({ items: [kw("k1", "Tokyo 友達")], limit: 100, canEdit: true });
  getKeywordIdeaPrompt.mockReset().mockResolvedValue({ prompt: "キーワードの案のプロンプト" });
  createKeywordsBatch.mockReset();
  toastSuccess.mockReset();
});

const panel = () => within(screen.getByRole("region", { name: "何を検索すればいいか迷ったら" }));

describe("キーワードの案", () => {
  it("「AIにキーワードの案を出してもらう」でプロンプトをコピーし、貼り付け欄が開く（FR-090）", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderKeywords();
    await user.click(await screen.findByRole("button", { name: "AIにキーワードの案を出してもらう" }));
    await waitFor(() => expect(writeText.mock.calls.at(-1)?.[0]).toBe("キーワードの案のプロンプト"));
    expect(panel().getByRole("textbox", { name: "AIの答えを貼り付ける" })).toBeInTheDocument();
  });

  it("貼ると1行ずつチェック付きの一覧になり、登録済み・長すぎ・重なりはチェックできない。選んだものだけまとめて登録する（FR-091・FR-092）", async () => {
    const user = userEvent.setup();
    createKeywordsBatch.mockResolvedValue({ items: [] });
    renderKeywords();
    await user.click(await screen.findByRole("button", { name: "AIにキーワードの案を出してもらう" }));
    const box = panel().getByRole("textbox", { name: "AIの答えを貼り付ける" });
    await user.click(box);
    await user.paste(["1. 上京 さみしい｜孤独の声", "2. ｔｏｋｙｏ 友達｜登録済み", "3. 休日 ひとり", "4. 上京 さみしい", `5. ${"あ".repeat(101)}`].join("\n"));
    const items = panel().getAllByRole("checkbox");
    expect(items).toHaveLength(5);
    expect(items.map((c) => (c as HTMLInputElement).disabled)).toEqual([false, true, false, true, true]);
    expect(panel().getByText("登録済みです")).toBeInTheDocument();
    expect(panel().getByText("一覧の中で重なっています")).toBeInTheDocument();
    expect(panel().getByText("長すぎます（100文字まで）")).toBeInTheDocument();
    await user.click(items[2]!);
    await user.click(panel().getByRole("button", { name: "1件を登録する" }));
    expect(createKeywordsBatch).toHaveBeenCalledWith("a1", { items: [{ keyword: "上京 さみしい", purpose: "孤独の声" }] });
    expect(toastSuccess).toHaveBeenCalledWith("1件のキーワードを登録しました");
    await waitFor(() => expect(listResearchKeywords).toHaveBeenCalledTimes(2));
  });

  it("登録の途中は、貼り付け欄と選択を変えられない（後から貼った案を失わない。PR #17 のCodexレビュー）", async () => {
    const user = userEvent.setup();
    createKeywordsBatch.mockImplementation(() => new Promise(() => {}));
    renderKeywords();
    await user.click(await screen.findByRole("button", { name: "AIにキーワードの案を出してもらう" }));
    await user.click(panel().getByRole("textbox", { name: "AIの答えを貼り付ける" }));
    await user.paste("新しい言葉");
    await user.click(panel().getByRole("button", { name: "1件を登録する" }));
    await waitFor(() => expect(panel().getByRole("textbox", { name: "AIの答えを貼り付ける" })).toBeDisabled());
    expect(panel().getAllByRole("checkbox")[0]).toBeDisabled();
  });

  it("貼り付けたまま画面を移ろうとすると、未保存の確認が出る（PR #17 のCodexレビュー6回目）", async () => {
    const user = userEvent.setup();
    renderKeywords();
    await user.click(await screen.findByRole("button", { name: "AIにキーワードの案を出してもらう" }));
    await user.click(panel().getByRole("textbox", { name: "AIの答えを貼り付ける" }));
    await user.paste("新しい言葉");
    await user.click(screen.getByRole("link", { name: "ホームへ" }));
    expect(await screen.findByText("保存していない変更があります")).toBeInTheDocument();
  });

  it("残りの件数を超えて選んでいると登録できず、残りの件数を示す（FR-092）", async () => {
    const user = userEvent.setup();
    listResearchKeywords.mockResolvedValue({ items: Array.from({ length: 99 }, (_, i) => kw(`k${i}`, `言葉${i}`)), limit: 100, canEdit: true });
    renderKeywords();
    await user.click(await screen.findByRole("button", { name: "AIにキーワードの案を出してもらう" }));
    await user.click(panel().getByRole("textbox", { name: "AIの答えを貼り付ける" }));
    await user.paste("新しいA\n新しいB");
    expect(panel().getByRole("button", { name: "2件を登録する" })).toBeDisabled();
    expect(panel().getByText("キーワードはあと1件まで登録できます")).toBeInTheDocument();
  });

  it("登録で重なりや上限に当たったら、知らせて一覧を読み直す", async () => {
    const user = userEvent.setup();
    createKeywordsBatch.mockRejectedValue(new ApiError("KEYWORD_DUPLICATE", 409, ["上京 さみしい"]));
    renderKeywords();
    await user.click(await screen.findByRole("button", { name: "AIにキーワードの案を出してもらう" }));
    await user.click(panel().getByRole("textbox", { name: "AIの答えを貼り付ける" }));
    await user.paste("上京 さみしい");
    await user.click(panel().getByRole("button", { name: "1件を登録する" }));
    expect(await panel().findByText("すでに登録されているキーワードがあります：上京 さみしい")).toBeInTheDocument();
    await waitFor(() => expect(listResearchKeywords).toHaveBeenCalledTimes(2));
  });

  it("キーワードの各行に「Threadsで検索」（新しいタブ）（FR-093）", async () => {
    renderKeywords();
    const link = await screen.findByRole("link", { name: "「Tokyo 友達」をThreadsで検索" });
    expect(link).toHaveAttribute("href", "https://www.threads.com/search?q=Tokyo%20%E5%8F%8B%E9%81%94");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("直せない人には案のカードを出さず、「Threadsで検索」だけ使える", async () => {
    listReferencePosts.mockResolvedValue({ items: [], limit: 200, canEdit: false });
    listResearchKeywords.mockResolvedValue({ items: [kw("k1", "Tokyo 友達")], limit: 100, canEdit: false });
    renderKeywords();
    expect(await screen.findByRole("link", { name: "「Tokyo 友達」をThreadsで検索" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "何を検索すればいいか迷ったら" })).not.toBeInTheDocument();
  });
});
