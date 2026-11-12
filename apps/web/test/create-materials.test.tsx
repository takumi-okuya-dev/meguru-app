// US11：プロンプトに入っている情報（specs/014-strategy-guidance FR-120〜FR-122、contracts/ui-routes.md「投稿をつくる」）
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HINTED_KEYS, type PromptMaterials } from "@meguru/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ACCESS } from "./helpers/access";
import { listResponse, promptResponse, renderAccountRoutes } from "./helpers/stock";

const listPostDrafts = vi.fn();
const getPrompt = vi.fn();
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, accountAccess: async () => OWNER_ACCESS, listPostDrafts, getPrompt } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { CreatePage } = await import("@/apps/threads/pages/create");

function materials(over: Partial<PromptMaterials> = {}): PromptMaterials {
  const items: PromptMaterials["strategy"]["items"] = [
    ...HINTED_KEYS.slice(0, 5).map((key) => ({ key, status: "empty" as const, chars: 0 })),
    { key: "activityAxis", status: null, chars: 0 },
    ...HINTED_KEYS.slice(5).map((key) => ({ key, status: "ok" as const, chars: 40 })),
  ];
  items[6] = { key: "finalAction", status: "short", chars: 12 };
  return {
    strategy: { items, done: 15, review: 1, purposeDone: 0 },
    drafts: { profileBio: true, pinned: [false, true, false] },
    promotions: { included: 2, missingCta: 1 },
    research: { total: 12, included: 10, explained: 4, pending: 8 },
    ...over,
  };
}

function renderCreate() {
  return renderAccountRoutes([{ path: "create", element: <CreatePage /> }], "/threads/accounts/a1/create");
}

beforeEach(() => {
  listPostDrafts.mockReset().mockResolvedValue(listResponse());
  getPrompt.mockReset().mockResolvedValue({ ...promptResponse(), materials: materials() });
});

describe("プロンプトに入っている情報", () => {
  it("初めは閉じていて、まとめの行は出さない（FR-120。文字を減らすため 2026-11-04）", async () => {
    renderCreate();
    const toggle = await screen.findByRole("button", { name: /プロンプトに入っている情報/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent(/^プロンプトに入っている情報$/);
    expect(screen.queryByRole("region", { name: "課題" })).not.toBeInTheDocument();
  });

  it("開くと、課題の判定と文字数・下書き・宣伝内容・リサーチの一覧と、プロンプトのどの節に入るかを出す（FR-121）", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(await screen.findByRole("button", { name: /プロンプトに入っている情報/ }));
    const strategy = within(screen.getByRole("region", { name: "課題" }));
    expect(strategy.getByText("→ プロンプトの「戦略設計」「活動の目的・在り方」に入ります")).toBeInTheDocument();
    const row = within(strategy.getByRole("listitem", { name: "最終的に読者に取ってほしい行動" }));
    expect(row.getByText("短め")).toBeInTheDocument();
    expect(row.getByText("12字")).toBeInTheDocument();
    expect(within(strategy.getByRole("listitem", { name: "活動の軸" })).getByText("未入力")).toBeInTheDocument();

    const drafts = within(screen.getByRole("region", { name: "プロフィール・固定投稿（下書き）" }));
    expect(within(drafts.getByRole("listitem", { name: "プロフィール文" })).getByText("入力あり")).toBeInTheDocument();
    expect(within(drafts.getByRole("listitem", { name: "固定投稿①" })).getByText("未入力")).toBeInTheDocument();

    const promotions = within(screen.getByRole("region", { name: "宣伝内容" }));
    expect(promotions.getByText("プロンプトに入る宣伝内容 2件（行動喚起が未記載 1件）")).toBeInTheDocument();

    const research = within(screen.getByRole("region", { name: "リサーチ" }));
    expect(research.getByText("参考投稿 12件（プロンプトに入るのは10件）・解説あり 4件・解説がまだ 8件")).toBeInTheDocument();
  });

  it("「編集」と「解説がまだ」の行き先（FR-122）", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(await screen.findByRole("button", { name: /プロンプトに入っている情報/ }));
    const strategy = within(screen.getByRole("region", { name: "課題" }));
    expect(within(strategy.getByRole("listitem", { name: "最終的に読者に取ってほしい行動" })).getByRole("link", { name: "編集" })).toHaveAttribute(
      "href",
      "/threads/accounts/a1/strategy#field-finalAction",
    );
    const drafts = within(screen.getByRole("region", { name: "プロフィール・固定投稿（下書き）" }));
    expect(within(drafts.getByRole("listitem", { name: "固定投稿②" })).getByRole("link", { name: "編集" })).toHaveAttribute(
      "href",
      "/threads/accounts/a1/strategy#field-pinnedPostDraft2",
    );
    expect(within(screen.getByRole("region", { name: "宣伝内容" })).getByRole("link", { name: "編集" })).toHaveAttribute(
      "href",
      "/threads/accounts/a1/promotions",
    );
    const research = within(screen.getByRole("region", { name: "リサーチ" }));
    expect(research.getByRole("link", { name: "編集" })).toHaveAttribute("href", "/threads/accounts/a1/research");
    expect(research.getByRole("link", { name: "解説がまだ8件 → まとめてAIに解説してもらう" })).toHaveAttribute(
      "href",
      "/threads/accounts/a1/research#explain",
    );
  });

  it("解説がまだの参考投稿がなければ、まとめての解説への案内は出さない", async () => {
    const user = userEvent.setup();
    getPrompt.mockResolvedValue({
      ...promptResponse(),
      materials: materials({ research: { total: 3, included: 3, explained: 3, pending: 0 } }),
    });
    renderCreate();
    await user.click(await screen.findByRole("button", { name: /プロンプトに入っている情報/ }));
    expect(screen.queryByRole("link", { name: /まとめてAIに解説してもらう/ })).not.toBeInTheDocument();
  });

  it("プロンプトを作れない人には出さない（FR-120）", async () => {
    listPostDrafts.mockResolvedValue(listResponse({ canGeneratePrompt: false }));
    renderCreate();
    expect(await screen.findByText("今はAIプロンプトを作れません")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /プロンプトに入っている情報/ })).not.toBeInTheDocument();
  });
});
