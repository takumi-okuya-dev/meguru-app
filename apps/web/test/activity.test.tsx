// 操作の記録（specs/008-team-operations contracts/ui-routes.md「操作の記録」、US4）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountAccessResponse, AccountSummary, ActivityList } from "@threads-grower/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_ACCESS } from "./helpers/access";

const listActivity = vi.fn();
let access: AccountAccessResponse;
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, listActivity, accountAccess: () => Promise.resolve(access) } };
});
const { ActivityPage, actionText } = await import("@/pages/activity");

const PARTNER_ACCESS: AccountAccessResponse = {
  role: "partner",
  permissions: ["view", "content", "activity"],
  owner: { name: "鈴木 花子" },
  hasTeam: true,
  team: { name: "A社", partnerName: "田中 健" },
  delegation: { review: false, settings: false },
};
const account: AccountSummary = {
  id: "a1",
  username: "cafe_b",
  displayName: "カフェ B店",
  profilePictureUrl: null,
  plan: "auto-only",
  connectionStatus: "connected",
  lastUsedAt: null,
  role: "partner",
  ownerName: "鈴木 花子",
};

const page1: ActivityList = {
  items: [
    {
      id: "1",
      at: new Date().toISOString(),
      actor: { userId: "u-o", name: "鈴木 花子", role: "owner" },
      kind: "review",
      action: "drafts_approved",
      itemCount: 3,
      summary: "雨の日は、窓ぎわの席が…",
      details: { excerpts: ["雨の日は、窓ぎわの席が…", "朝の仕込みの音", "限定のシフォン"] },
    },
    {
      id: "2",
      at: "2026-10-08T12:12:00.000Z",
      actor: { userId: "u-p", name: "田中 健", role: "partner" },
      kind: "member",
      action: "assignment_added",
      itemCount: 1,
      summary: "高橋 涼",
      details: null,
    },
  ],
  actors: [
    { userId: "u-o", name: "鈴木 花子", role: "owner" },
    { userId: "u-p", name: "田中 健", role: "partner" },
  ],
  nextCursor: "c1",
};

function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: <Outlet context={{ account }} />,
        children: [
          { index: true, element: <p>ホームの中身</p> },
          { path: "activity", element: <ActivityPage /> },
        ],
      },
    ],
    { initialEntries: ["/accounts/a1/activity"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  access = PARTNER_ACCESS;
  listActivity.mockReset();
});

describe("操作の記録", () => {
  it("日付ごとに新しい順で、人（役割）・操作・対象を出す。まとめての行は開くと書き出しの一覧", async () => {
    listActivity.mockResolvedValueOnce(page1).mockResolvedValue({ ...page1, items: [], nextCursor: null });
    const user = userEvent.setup();
    renderPage();
    const row = await screen.findByRole("button", { name: /鈴木 花子（オーナー）が3件を承認しました/ });
    expect(screen.getByText(/^今日 · /)).toBeInTheDocument();
    expect(screen.getByText(/高橋 涼さんをこのアカウントの担当にしました/)).toBeInTheDocument();
    await user.click(row);
    expect(within(row.closest("li")!).getByText("限定のシフォン")).toBeInTheDocument();
    expect(screen.getByText("記録は、チームで運用しているアカウントだけに、90日分残ります。オーナーとパートナーが見られます。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "続きを読む" }));
    expect(listActivity).toHaveBeenLastCalledWith("a1", { kind: "", actor: "", cursor: "c1" });
  });

  it("種類のチップと人の選択で絞り込む", async () => {
    listActivity.mockResolvedValue(page1);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/3件を承認しました/);
    await user.click(screen.getByRole("button", { name: "メンバー" }));
    expect(screen.getByRole("button", { name: "メンバー" })).toHaveAttribute("aria-pressed", "true");
    expect(listActivity).toHaveBeenLastCalledWith("a1", { kind: "member", actor: "", cursor: undefined });
    await user.selectOptions(screen.getByLabelText("人で絞り込む"), "u-p");
    expect(listActivity).toHaveBeenLastCalledWith("a1", { kind: "member", actor: "u-p", cursor: undefined });
    // 「設定・戦略」は戦略・素材と設定の両方（PR #9 のCodexレビュー2回目）
    await user.click(screen.getByRole("button", { name: "設定・戦略" }));
    expect(listActivity).toHaveBeenLastCalledWith("a1", { kind: "content,settings", actor: "u-p", cursor: undefined });
  });

  it("空の状態", async () => {
    listActivity.mockResolvedValue({ items: [], actors: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText("まだ記録はありません。")).toBeInTheDocument();
  });

  it("編集者はAccountのホームへ移る", async () => {
    access = EDITOR_ACCESS;
    renderPage();
    expect(await screen.findByText("ホームの中身")).toBeInTheDocument();
    expect(listActivity).not.toHaveBeenCalled();
  });

  it("操作のコードの文言", () => {
    expect(actionText({ ...page1.items[0]!, action: "draft_edited", details: { reopened: true } })).toBe(
      "承認済みの案を直しました（要確認に戻りました）",
    );
    expect(actionText({ ...page1.items[0]!, action: "partner_removed" })).toBe("パートナーを外しました");
  });
});
