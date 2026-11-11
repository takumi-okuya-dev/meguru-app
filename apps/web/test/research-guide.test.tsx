// US6：リサーチの画面の「伸びる投稿を見つけるリサーチ」（specs/014-strategy-guidance FR-060・FR-062）
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderResearchPage } from "./helpers/research";

vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listReferencePosts: async () => ({ items: [], limit: 200, canEdit: true }),
      listResearchKeywords: async () => ({ items: [], limit: 100, canEdit: true }),
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ResearchPage } = await import("@/apps/threads/pages/research");

beforeEach(() => localStorage.clear());

describe("伸びる投稿を見つけるリサーチ", () => {
  it("タブの下に閉じた状態で置き、開くと5つの話が読める。成果を約束する言い方をしない", async () => {
    const user = userEvent.setup();
    renderResearchPage(ResearchPage);
    const toggle = await screen.findByRole("button", { name: /伸びる投稿を見つけるリサーチ/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("tablist").compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(toggle);
    const guide = within(screen.getByRole("region", { name: "伸びる投稿を見つけるリサーチ" }));
    for (const h of [
      "① 良い参考アカウントを見極める3つの指標",
      "② 真似してよい投稿",
      "③ 真似しない方がよい投稿",
      "④ リサーチの5つの手順",
      "⑤ 登録する前の5つの確認",
    ]) {
      expect(guide.getByRole("heading", { name: h })).toBeInTheDocument();
    }
    const text = screen.getByRole("region", { name: "伸びる投稿を見つけるリサーチ" }).textContent ?? "";
    expect(text).toContain("1,000人以上");
    expect(text).toContain("2,000回以上");
    expect(text).toContain("集めたい人に届き、くり返し使える型");
    expect(text).not.toMatch(/必ず(伸び|増え)|確実に/);
  });

  it("キーワードのタブでも出る", async () => {
    renderResearchPage(ResearchPage, "/accounts/a1/research?tab=keywords");
    expect(await screen.findByRole("button", { name: /伸びる投稿を見つけるリサーチ/ })).toBeInTheDocument();
  });
});
