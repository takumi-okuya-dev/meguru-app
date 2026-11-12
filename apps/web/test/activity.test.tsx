// 操作の記録（specs/008-team-operations contracts/ui-routes.md「操作の記録」、US4）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountAccessResponse, AccountSummary, ActivityList } from "@meguru/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ACCESS, EDITOR_ACCESS } from "./helpers/access";

const listActivity = vi.fn();
let access: AccountAccessResponse;
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api } };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, listActivity, accountAccess: () => Promise.resolve(access) } };
});
const { ActivityPage, actionText } = await import("@/apps/threads/pages/activity");

const account: AccountSummary = {
  id: "a1",
  name: "カフェ B店",
  username: "cafe_b",
  displayName: "カフェ B店",
  profilePictureUrl: null,
  connectionStatus: "connected",
  lastUsedAt: null,
  role: "editor",
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
      actor: { userId: "u-p", name: "田中 健", role: "admin" },
      kind: "member",
      action: "assignment_added",
      itemCount: 1,
      summary: "高橋 涼",
      details: null,
    },
  ],
  actors: [
    { userId: "u-o", name: "鈴木 花子", role: "owner" },
    { userId: "u-p", name: "田中 健", role: "admin" },
  ],
  nextCursor: "c1",
};

function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: "/threads/accounts/:accountId",
        element: <Outlet context={{ account }} />,
        children: [
          { index: true, element: <p>ホームの中身</p> },
          { path: "activity", element: <ActivityPage /> },
        ],
      },
    ],
    { initialEntries: ["/threads/accounts/a1/activity"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  access = ADMIN_ACCESS;
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
    expect(screen.getByText("記録は、チームに入っているアカウントだけに、90日分残ります。オーナーと、このアカウントを担当している管理者が見られます。")).toBeInTheDocument();
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

  it("読み込みに失敗したら「まだ記録はありません」と出さず、再読み込みで出す（PR #9 のCodexレビュー）", async () => {
    listActivity.mockRejectedValueOnce(new Error("network")).mockResolvedValue(page1);
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("操作の記録を読み込めませんでした。")).toBeInTheDocument();
    expect(screen.queryByText("まだ記録はありません。")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByText(/3件を承認しました/)).toBeInTheDocument();
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
    // アカウントを先に作る（specs/012 data-model.md「操作の記録」）
    expect(actionText({ ...page1.items[0]!, action: "account_renamed", details: { from: "カフェ", to: "カフェの公式" } })).toBe(
      "アカウントの名前を「カフェの公式」に変えました",
    );
    expect(actionText({ ...page1.items[0]!, action: "threads_connected", details: { method: "token" } })).toBe(
      "Threadsにつなぎました（自分のMetaアプリのトークン）",
    );
    // チームの操作（specs/011 data-model.md「activity_logs」）
    expect(actionText({ ...page1.items[0]!, action: "team_member_joined", summary: "山口 誠" })).toBe("山口 誠さんがチームに参加しました");
    expect(
      actionText({ ...page1.items[0]!, action: "team_role_changed", summary: "佐藤 美咲", details: { from: "member", to: "editor" } }),
    ).toBe("佐藤 美咲さんのロールを編集者にしました");
    expect(actionText({ ...page1.items[0]!, action: "team_share_changed", details: { shared: true } })).toBe("チームに見せるようにしました");
    expect(actionText({ ...page1.items[0]!, action: "team_admin_transferred", summary: "鈴木 花子" })).toBe("管理者を鈴木 花子さんに引き継ぎました");
  });

  it("014で足した操作の文言（specs/014 T092）", () => {
    const item = page1.items[0]!;
    expect(actionText({ ...item, action: "reference_posts_added", summary: "3件" })).toBe("参考投稿を3件まとめて登録しました");
    expect(actionText({ ...item, action: "reference_posts_explained", summary: "2件" })).toBe("2件の参考投稿にAIの解説を入れました");
    expect(actionText({ ...item, action: "research_keywords_added", summary: "5件" })).toBe("キーワードを5件まとめて登録しました");
    expect(actionText({ ...item, action: "prompt_length_saved", summary: "200字・35/45/20%" })).toBe(
      "投稿の文字数と割合を変えました（200字・35/45/20%）",
    );
  });
});
