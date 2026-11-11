// 運用状況の画面（/teams/:teamId/status。specs/020-team-monitoring contracts/ui-routes.md 2、T013・T019・T027・T031）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamStatus } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getTeam: vi.fn(), teamStatus: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});

const { ApiError } = await import("@/lib/api-client");
const { TeamStatusPage } = await import("@/pages/team-status");

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const person = (over: Partial<TeamStatus["people"][number]>): TeamStatus["people"][number] => ({
  userId: "u",
  name: "名前",
  role: "member",
  isMe: false,
  joinedAt: ago(30),
  lastActiveAt: ago(0),
  activeCount7d: 0,
  stopped: false,
  retentionLimited: false,
  ...over,
});

const account = (
  over: Partial<TeamStatus["accounts"][number]>,
): TeamStatus["accounts"][number] => ({
  accountId: "a",
  name: "店",
  username: "shop",
  displayName: null,
  profilePictureUrl: null,
  owner: { userId: "u", name: "名前", isMe: false },
  connection: "connected",
  addedAt: ago(30),
  lastPostedAt: ago(0),
  postCount7d: 0,
  approvedCount: 0,
  needsReviewCount: 0,
  stopped: false,
  growth: { state: "insufficient" },
  ...over,
});

function adminStatus(): TeamStatus {
  return {
    scope: "all",
    generatedAt: ago(0),
    stoppedCount: 3,
    people: [
      person({ userId: "u-t", name: "田中", stopped: true, lastActiveAt: null }),
      person({
        userId: "u-s",
        name: "鈴木",
        stopped: true,
        lastActiveAt: ago(9),
        activeCount7d: 0,
      }),
      person({
        userId: "u-o",
        name: "大野",
        stopped: true,
        lastActiveAt: null,
        retentionLimited: true,
      }),
      person({ userId: "u-e", name: "佐藤", role: "editor", activeCount7d: 14 }),
      person({
        userId: "u-a",
        name: "山田",
        role: "admin",
        isMe: true,
        lastActiveAt: ago(1),
        activeCount7d: 6,
      }),
    ],
    accounts: [
      account({
        accountId: "a-s",
        name: "鈴木ベーカリー",
        owner: { userId: "u-s", name: "鈴木", isMe: false },
        stopped: true,
        lastPostedAt: ago(8),
        needsReviewCount: 4,
        connection: "disconnected",
      }),
      account({
        accountId: "a-t",
        name: "田中整体院",
        owner: { userId: "u-t", name: "田中", isMe: false },
        postCount7d: 7,
        approvedCount: 12,
        growth: { state: "poor", ratio: 0.6, recentMedian: 60, previousMedian: 100 },
      }),
      account({
        accountId: "a-e",
        name: "佐藤ネイル",
        owner: { userId: "u-e", name: "佐藤", isMe: false },
        growth: { state: "ok", ratio: 1.3, recentMedian: 130, previousMedian: 100 },
      }),
      account({
        accountId: "a-a",
        name: "山田カフェ",
        owner: { userId: "u-a", name: "山田", isMe: true },
        growth: { state: "metrics_off" },
      }),
    ],
  };
}

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: "/teams/:teamId/status", element: <TeamStatusPage /> },
      { path: "/teams/:teamId", element: <p>チームの画面</p> },
    ],
    { initialEntries: ["/teams/t1/status"] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.getTeam.mockResolvedValue({
    id: "t1",
    name: "チーム1",
    myRole: "admin",
    admin: { userId: "u-a", name: "山田" },
    members: [],
    limits: { members: 50, editors: 10 },
    statusVisible: true,
  });
  mocks.teamStatus.mockResolvedValue(adminStatus());
});

describe("運用状況（管理者）", () => {
  it("一行の説明と、閉じたトグル「見方」", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole("heading", { name: "運用状況" })).toBeInTheDocument();
    expect(
      await screen.findByText("チーム1 · 見えるのは管理者と担当の編集者だけ"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "見方" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "見方" }));
    const help = screen.getByRole("list", { name: "見方" });
    expect(within(help).getByText(/×0.8以下で「伸びていない」/)).toBeInTheDocument();
    expect(within(help).getByText(/投稿の本文や戦略は見えません/)).toBeInTheDocument();
  });

  it("人：最後に動いた日・7日の動き・「止まっている」の印", async () => {
    renderPage();
    const list = await screen.findByRole("list", { name: "人の運用状況" });
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("田中")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("まだありません")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("止まっている")).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/（9日前）$/)).toBeInTheDocument();
    expect(within(rows[2]!).getByText("90日以内にありません")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("7日で14回")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("今日")).toBeInTheDocument();
    expect(within(rows[3]!).queryByText("止まっている")).not.toBeInTheDocument();
    expect(within(rows[4]!).getByText("山田（あなた）")).toBeInTheDocument();
    expect(within(rows[4]!).getByText("昨日")).toBeInTheDocument();
  });

  it("アカウント：オーナー・最後の投稿・7日の投稿・承認済み・要確認・接続", async () => {
    renderPage();
    const list = await screen.findByRole("list", { name: "アカウントの運用状況" });
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("鈴木さんのアカウント")).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/（8日前）$/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText("止まっている")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("要確認 4件")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("接続が切れています")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("7日で7件")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("承認済み 12件")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("あなたのアカウント")).toBeInTheDocument();
  });

  it("伸び：poor は矢印と比と「伸びていない」、ok は比、insufficient・metrics_off は言葉", async () => {
    renderPage();
    const rows = within(
      await screen.findByRole("list", { name: "アカウントの運用状況" }),
    ).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("まだ判定できません")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("×0.6")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("伸びていない")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("×1.3")).toBeInTheDocument();
    expect(within(rows[2]!).queryByText("伸びていない")).not.toBeInTheDocument();
    expect(within(rows[3]!).getByText("取り込んでいません")).toBeInTheDocument();
  });

  it("スマートフォンでも横にスクロールさせない：表を使わず、行は狭い画面で縦に積む（FR-032）", async () => {
    renderPage();
    const list = await screen.findByRole("list", { name: "アカウントの運用状況" });
    expect(document.querySelector("table")).toBeNull();
    for (const li of within(list).getAllByRole("listitem"))
      expect(li.className).toMatch(/(^| )flex-col( |$)/);
    expect(document.querySelector(".overflow-x-auto")).toBeNull();
  });
});

describe("運用状況（編集者・見られない人）", () => {
  it("担当の範囲なら、一行の説明が「あなたの担当のアカウントだけ」", async () => {
    mocks.teamStatus.mockResolvedValue({ ...adminStatus(), scope: "assigned" });
    renderPage();
    expect(await screen.findByText("チーム1 · あなたの担当のアカウントだけ")).toBeInTheDocument();
  });

  it("ROLE_FORBIDDEN なら、管理者と担当の編集者だけが見られると出し、チームに戻れる", async () => {
    mocks.teamStatus.mockRejectedValue(new ApiError("ROLE_FORBIDDEN", 403));
    const user = userEvent.setup();
    const router = renderPage();
    expect(
      await screen.findByText("この画面は、管理者と担当の編集者だけが見られます。"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "チームの画面に戻る" }));
    expect(router.state.location.pathname).toBe("/teams/t1");
  });
});
