// US12：「投稿をつくる」の進め方の案内（specs/014-strategy-guidance FR-130、research.md R15）。
// コピーの注意（FR-131）と自分で1件書く入口（FR-132）は、文字を減らすため外した（2026-11-04）
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ACCESS } from "./helpers/access";
import { listResponse, promptResponse, renderAccountRoutes } from "./helpers/stock";

const listPostDrafts = vi.fn();
const getPrompt = vi.fn();
const createDraftBatch = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, accountAccess: async () => OWNER_ACCESS, listPostDrafts, getPrompt, createDraftBatch } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { CreatePage } = await import("@/pages/create");

const STEPS_KEY = "threads-grower:create-steps-collapsed";

function renderCreate() {
  return renderAccountRoutes([{ path: "create", element: <CreatePage /> }], "/accounts/a1/create");
}

beforeEach(() => {
  localStorage.clear();
  listPostDrafts.mockReset().mockResolvedValue(listResponse());
  getPrompt.mockReset().mockResolvedValue(promptResponse());
  createDraftBatch.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("投稿ができるまでの5つの手順（FR-130）", () => {
  it("プロンプトの上に5つの手順と、①の各画面・⑤の投稿ストックへのリンクが出る", async () => {
    renderCreate();
    const steps = within(await screen.findByRole("region", { name: "投稿ができるまでの5つの手順" }));
    expect(steps.getAllByRole("listitem").map((li) => li.textContent?.slice(0, 1))).toEqual(["①", "②", "③", "④", "⑤"]);
    expect(steps.getByRole("link", { name: "課題" })).toHaveAttribute("href", "/accounts/a1/strategy");
    expect(steps.getByRole("link", { name: "宣伝内容" })).toHaveAttribute("href", "/accounts/a1/promotions");
    expect(steps.getByRole("link", { name: "リサーチ" })).toHaveAttribute("href", "/accounts/a1/research");
    expect(steps.getByRole("link", { name: "投稿ストック" })).toHaveAttribute("href", "/accounts/a1/stock");
    const prompt = await screen.findByRole("region", { name: "プロンプト" });
    expect(
      screen.getByRole("region", { name: "投稿ができるまでの5つの手順" }).compareDocumentPosition(prompt) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("「閉じる」で見出し1行になり、閉じたことを端末に覚える。「開く」で戻る", async () => {
    const user = userEvent.setup();
    renderCreate();
    const region = await screen.findByRole("region", { name: "投稿ができるまでの5つの手順" });
    await user.click(within(region).getByRole("button", { name: "閉じる" }));
    expect(within(region).queryByRole("listitem")).not.toBeInTheDocument();
    expect(localStorage.getItem(STEPS_KEY)).toBe("true");
    await user.click(within(region).getByRole("button", { name: "開く" }));
    expect(within(region).getAllByRole("listitem")).toHaveLength(5);
    expect(localStorage.getItem(STEPS_KEY)).toBe("false");
  });

  it("閉じたことを覚えていれば、閉じた状態で開く", async () => {
    localStorage.setItem(STEPS_KEY, "true");
    renderCreate();
    const region = await screen.findByRole("region", { name: "投稿ができるまでの5つの手順" });
    expect(within(region).getByRole("button", { name: "開く" })).toBeInTheDocument();
    expect(within(region).queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("端末に覚えた値を読めないときは、開いた状態で出す", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderCreate();
    const region = await screen.findByRole("region", { name: "投稿ができるまでの5つの手順" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(5);
  });

  it("プロンプトを作れない（読むだけ）ときは、手順を出さない", async () => {
    listPostDrafts.mockResolvedValue(listResponse({ canGeneratePrompt: false }));
    renderCreate();
    expect(await screen.findByText("今はAIプロンプトを作れません")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "投稿ができるまでの5つの手順" })).not.toBeInTheDocument();
  });
});

describe("貼り付け欄の案内（2026-11-04）", () => {
  it("区切りの案内は欄の中に出し、コピーの注意と「自分で1件書く」は出さない", async () => {
    renderCreate();
    const box = await screen.findByRole("textbox", { name: "AIの返信を貼り付ける欄" });
    expect(box).toHaveAttribute("placeholder", "AIの返信をここに貼り付け…\n「@@@」で区切られた投稿が、まとめて「要確認」に登録されます");
    expect(screen.queryByText(/答えの下にあるコピーボタンで全体をコピー/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "自分で1件書く" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "リサーチを見る" })).not.toBeInTheDocument();
  });
});
