// 担当を決める（/teams/:teamId/assign。specs/011-team-revision contracts/ui-routes.md「担当を決める」、T024）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamAssignments } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getTeam: vi.fn(), getAssignments: vi.fn(), assign: vi.fn(), unassign: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { ApiError } = await import("@/lib/api-client");
const { TeamAssignPage } = await import("@/apps/threads/pages/team-assign");

const table: TeamAssignments = {
  accounts: [
    { id: "a-a", name: "A社 SNS運用", username: "a_sha", displayName: "A社 SNS運用", profilePictureUrl: null, ownerUserId: "u-a", ownerName: "田中 健" },
    { id: "a-s", name: "カフェ B店", username: "cafe_b", displayName: "カフェ B店", profilePictureUrl: null, ownerUserId: "u-s", ownerName: "鈴木 花子" },
    { id: "a-e", name: "佐藤のおうちごはん", username: "sato", displayName: "佐藤のおうちごはん", profilePictureUrl: null, ownerUserId: "u-e", ownerName: "佐藤 美咲" },
  ],
  people: [
    { userId: "u-a", name: "田中 健", role: "admin", isMe: true, accountIds: [] },
    { userId: "u-e", name: "佐藤 美咲", role: "editor", isMe: false, accountIds: ["a-s"] },
  ],
};

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: "/teams/:teamId/assign", element: <TeamAssignPage /> },
      { path: "/teams/:teamId", element: <p>チームの画面</p> },
    ],
    { initialEntries: ["/teams/t1/assign"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  for (const fn of [...Object.values(mocks), ...Object.values(toast)]) fn.mockReset();
  mocks.getTeam.mockResolvedValue({ id: "t1", name: "飲食チーム", myRole: "admin", admin: { userId: "u-a", name: "田中 健" }, members: [], limits: { members: 50, editors: 10 } });
  mocks.getAssignments.mockResolvedValue(table);
});

describe("担当を決める", () => {
  it("行＝編集者と管理者、列＝チームのアカウント（オーナー名つき）。自分のアカウントのセルは「自分」。説明と注記", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "担当を決める" })).toBeInTheDocument();
    expect(screen.getByText("飲食チーム")).toBeInTheDocument();
    expect(screen.getByText(/ロールが「メンバー」の人は、ここに出ません/)).toBeInTheDocument();
    expect(screen.getByText(/オーナーが「チームに見せる」をオフにしていても、その人は開けます/)).toBeInTheDocument();
    const rows = await screen.findAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("田中 健（あなた）")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("自分")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("自分")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "佐藤 美咲をカフェ B店（@cafe_b）の担当にする" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "田中 健をカフェ B店（@cafe_b）の担当にする" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("link", { name: "チームの画面に戻る" })).toHaveAttribute("href", "/teams/t1");
  });

  it("押すとすぐ切り替え、失敗したら元に戻す（44pxの role=checkbox のボタン）", async () => {
    mocks.assign.mockRejectedValue(new ApiError("ASSIGNMENT_NOT_ALLOWED", 409));
    const user = userEvent.setup();
    renderPage();
    const cell = await screen.findByRole("checkbox", { name: "田中 健をカフェ B店（@cafe_b）の担当にする" });
    expect(cell).toHaveClass("size-11");
    await user.click(cell);
    expect(mocks.assign).toHaveBeenCalledWith("t1", "u-a", "a-s");
    expect(toast.error).toHaveBeenCalledWith("このアカウントは担当にできません。");
    expect(await screen.findByRole("checkbox", { name: "田中 健をカフェ B店（@cafe_b）の担当にする" })).toHaveAttribute("aria-checked", "false");
  });

  it("同じオーナーの同じ名前のアカウントも、列の見出しと読み上げの名前で@ユーザー名により見分けられる（PR #15 のCodexレビュー）", async () => {
    mocks.getAssignments.mockResolvedValue({
      ...table,
      accounts: [
        ...table.accounts,
        { id: "a-s2", name: "カフェ B店", username: "cafe_b2", displayName: "カフェ B店", profilePictureUrl: null, ownerUserId: "u-s", ownerName: "鈴木 花子" },
      ],
    });
    renderPage();
    const headers = await screen.findAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("@cafe_b鈴木"), expect.stringContaining("@cafe_b2鈴木")]),
    );
    expect(screen.getByRole("checkbox", { name: "佐藤 美咲をカフェ B店（@cafe_b）の担当にする" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "佐藤 美咲をカフェ B店（@cafe_b2）の担当にする" })).toHaveAttribute("aria-checked", "false");
  });

  it("担当を外す", async () => {
    mocks.unassign.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "佐藤 美咲をカフェ B店（@cafe_b）の担当にする" }));
    expect(mocks.unassign).toHaveBeenCalledWith("t1", "u-e", "a-s");
  });

  it("管理者でなければ表を出さない", async () => {
    mocks.getTeam.mockResolvedValue({ id: "t1", name: "飲食チーム", myRole: "editor", admin: { userId: "u-a", name: "田中 健" }, members: [], limits: { members: 50, editors: 10 } });
    renderPage();
    expect(await screen.findByText("担当を決められるのは、チームの管理者だけです。")).toBeInTheDocument();
    expect(mocks.getAssignments).not.toHaveBeenCalled();
  });
});
