// チームの画面（/teams/:teamId。specs/011-team-revision contracts/ui-routes.md「チームの画面」、T018・T023・T029・T032・T035）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResponse, TeamDetail } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "./helpers/billing";

const mocks = vi.hoisted(() => ({
  getTeam: vi.fn(),
  getTeamInvite: vi.fn(),
  rotateTeamInvite: vi.fn(),
  setMemberRole: vi.fn(),
  setTeamShared: vi.fn(),
  removeTeamAccount: vi.fn(),
  addTeamAccount: vi.fn(),
  leaveTeam: vi.fn(),
  removeMember: vi.fn(),
  transferAdmin: vi.fn(),
  renameTeam: vi.fn(),
  deleteTeam: vi.fn(),
  dismissJoinedNotice: vi.fn(),
  teamStatus: vi.fn(),
  me: vi.fn(),
}));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { ApiError } = await import("@/lib/api-client");
const { TeamPage } = await import("@/pages/team");

const acc = (id: string, name: string, extra: Partial<TeamDetail["members"][number]["accounts"][number]> = {}) => ({
  id,
  name: name,
  username: id,
  displayName: name,
  profilePictureUrl: null,
  shared: false,
  canOpen: false,
  relation: null,
  ...extra,
});

function adminView(): TeamDetail {
  return {
    id: "t1",
    name: "飲食チーム",
    myRole: "admin",
    admin: { userId: "u-a", name: "田中 健" },
    members: [
      { userId: "u-a", name: "田中 健", role: "admin", isMe: true, joinedAt: "", joinedNotice: false, accounts: [acc("a-a", "A社 SNS運用", { canOpen: true, relation: "owner" })] },
      { userId: "u-s", name: "鈴木 花子", role: "member", isMe: false, joinedAt: "", joinedNotice: true, accounts: [acc("a-s", "カフェ B店", { shared: true, canOpen: true, relation: "shared_viewer" })] },
      { userId: "u-y", name: "山口 誠", role: "member", isMe: false, joinedAt: "", joinedNotice: false, accounts: [acc("a-y", "ベーカリー E")] },
      { userId: "u-e", name: "佐藤 美咲", role: "editor", isMe: false, joinedAt: "", joinedNotice: false, accounts: [acc("a-e", "佐藤のおうちごはん")] },
    ],
    limits: { members: 50, editors: 10 },
    statusVisible: true,
  };
}

function memberView(): TeamDetail {
  const t = adminView();
  return {
    ...t,
    myRole: "member",
    statusVisible: false,
    members: t.members.map((m) => ({
      ...m,
      isMe: m.userId === "u-s",
      joinedNotice: false,
      accounts: m.userId === "u-s" ? [acc("a-s", "カフェ B店", { shared: true, canOpen: true, relation: "owner" })] : m.accounts,
    })),
  };
}

const meData: MeResponse = {
  user: { id: "u-s", email: "s@example.com", displayName: "鈴木 花子" },
  accounts: [
    { id: "a-s", name: "カフェ B店", username: "a-s", displayName: "カフェ B店", profilePictureUrl: null, connectionStatus: "connected", lastUsedAt: null, role: "owner", ownerName: null },
    { id: "a-s2", name: "カフェ B店 2号店", username: "a-s2", displayName: "カフェ B店 2号店", profilePictureUrl: null, connectionStatus: "connected", lastUsedAt: null, role: "owner", ownerName: null },
  ],
  landingAccountId: "a-s",
  accountLimit: { max: 3, used: 2 },
  ...ME_BILLING_OFF,
  threadsAccessMode: "testers",
  threadsConnectMethods: ["app", "token"] as const,
  teams: [{ id: "t1", name: "飲食チーム", memberCount: 4, role: "member" }],
};

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: "/teams/:teamId", element: <TeamPage /> },
      { path: "/teams/:teamId/assign", element: <p>担当の表</p> },
      { path: "/teams/:teamId/status", element: <p>運用状況の画面</p> },
      { path: "/teams/:teamId/accounts/:accountId", element: <p>見せてもらっているアカウント</p> },
      { path: "/accounts/:accountId", element: <p>Accountの画面</p> },
      { path: "/", element: <p>最初の画面</p> },
    ],
    { initialEntries: ["/teams/t1"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  for (const fn of Object.values(toast)) fn.mockReset();
  mocks.me.mockResolvedValue(meData);
  mocks.teamStatus.mockResolvedValue({ scope: "all", generatedAt: "", stoppedCount: 3, people: [], accounts: [] });
  for (const fn of [mocks.setMemberRole, mocks.setTeamShared, mocks.removeTeamAccount, mocks.addTeamAccount, mocks.leaveTeam, mocks.removeMember, mocks.transferAdmin, mocks.renameTeam, mocks.deleteTeam, mocks.dismissJoinedNotice])
    fn.mockResolvedValue(undefined);
});

describe("チームの画面（管理者）", () => {
  it("ヘッダーに名前・人数・管理者の操作。メンバー一覧は名前・「あなた」・アカウントのチップ（開けるものは「見る」、開けないものは点線）", async () => {
    mocks.getTeam.mockResolvedValue(adminView());
    renderPage();
    expect(await screen.findByRole("heading", { name: "飲食チーム" })).toBeInTheDocument();
    expect(screen.getByText(/メンバー 4人 · 管理者：田中 健/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "メンバーを招待" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "担当を決める" })).toHaveAttribute("href", "/teams/t1/assign");
    const list = screen.getByRole("list", { name: "メンバーの一覧" });
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("あなた")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("管理者（あなた）")).toBeInTheDocument();
    expect(within(rows[1]!).getByRole("link", { name: "鈴木 花子さんのカフェ B店を見る" })).toHaveAttribute("href", "/teams/t1/accounts/a-s");
    expect(within(rows[2]!).getByText("ベーカリー E · 見せていません")).toBeInTheDocument();
  });

  it("ロールの説明は「ロールについて」で開き、箇条書きで出す。「チームを抜ける」は一番下（2026-11-04）", async () => {
    mocks.getTeam.mockResolvedValue(adminView());
    const user = userEvent.setup();
    renderPage();
    const toggle = await screen.findByRole("button", { name: "ロールについて" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "ロールの説明" })).not.toBeInTheDocument();
    await user.click(toggle);
    const help = screen.getByRole("region", { name: "ロールの説明" });
    expect(within(help).getByText("・担当のアカウントで、投稿の案を作る・直す")).toBeInTheDocument();
    expect(toggle).toHaveTextContent(/^ロールについて$/);
    // 「⋯」の中は、チーム名を直す・チームを削除するだけ
    await user.click(screen.getByRole("button", { name: "チームの操作" }));
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["チーム名を直す", "チームを削除する"]);
    await user.keyboard("{Escape}");
    const buttons = screen.getAllByRole("button");
    expect(buttons.at(-1)).toHaveTextContent("チームを抜ける");
  });

  it("ロールの切り替え（aria-pressed の2つのボタン）。管理者自身の行には出さない（T023）", async () => {
    mocks.getTeam.mockResolvedValue(adminView());
    const user = userEvent.setup();
    renderPage();
    const group = await screen.findByRole("group", { name: "山口 誠さんのロール" });
    expect(within(group).getByRole("button", { name: "メンバー" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "編集者" }));
    expect(mocks.setMemberRole).toHaveBeenCalledWith("t1", "u-y", "editor");
    expect(screen.queryByRole("group", { name: "田中 健さんのロール" })).not.toBeInTheDocument();
  });

  it("参加の知らせ「（名前）さんが参加しました」と閉じる（T032）", async () => {
    mocks.getTeam.mockResolvedValue(adminView());
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("鈴木 花子さんが参加しました")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "鈴木 花子さんの参加の知らせを閉じる" }));
    expect(mocks.dismissJoinedNotice).toHaveBeenCalledWith("t1", "u-s");
  });

  it("「メンバーを招待」：チームの招待リンク・コピー・QRコード・作り直す", async () => {
    mocks.getTeam.mockResolvedValue(adminView());
    mocks.getTeamInvite.mockResolvedValue({ url: "http://localhost:5173/invite/t_" + "a".repeat(43), rotatedAt: "2026-10-13T00:00:00Z" });
    mocks.rotateTeamInvite.mockResolvedValue({ url: "http://localhost:5173/invite/t_" + "b".repeat(43), rotatedAt: "2026-10-13T00:01:00Z" });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "メンバーを招待" }));
    const dialog = await screen.findByRole("dialog", { name: "飲食チームにメンバーを招待" });
    expect(await within(dialog).findByDisplayValue(/invite\/t_a+$/)).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: "招待リンクのQRコード" })).toBeInTheDocument();
    expect(within(dialog).getByText(/入った人は、まずメンバーになります/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "リンクを作り直す" }));
    expect(await within(dialog).findByDisplayValue(/invite\/t_b+$/)).toBeInTheDocument();
  });

  it("「⋯」の「チーム名を直す」（1〜50文字）と「チームを削除する」（確認・赤のボタン。FR-017）", async () => {
    mocks.getTeam.mockResolvedValue(adminView());
    const user = userEvent.setup();
    const router = renderPage();
    await user.click(await screen.findByRole("button", { name: "チームの操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "チーム名を直す" }));
    const rename = await screen.findByRole("dialog", { name: "チーム名を直す" });
    const input = within(rename).getByLabelText("チーム名");
    await user.clear(input);
    expect(within(rename).getByRole("button", { name: "保存" })).toBeDisabled();
    await user.type(input, "飲食・カフェチーム");
    await user.click(within(rename).getByRole("button", { name: "保存" }));
    expect(mocks.renameTeam).toHaveBeenCalledWith("t1", "飲食・カフェチーム");

    await user.click(await screen.findByRole("button", { name: "チームの操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "チームを削除する" }));
    const del = await screen.findByRole("dialog", { name: "飲食チームを削除しますか？" });
    expect(within(del).getByText(/アカウントのデータと操作の記録は残ります/)).toBeInTheDocument();
    await user.click(within(del).getByRole("button", { name: "チームを削除する" }));
    expect(mocks.deleteTeam).toHaveBeenCalledWith("t1");
    expect(await screen.findByText("最初の画面")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("「チームを抜ける」：引き継ぎ先を選ぶまで「引き継いで抜ける」は押せない（T035）", async () => {
    mocks.getTeam.mockResolvedValue(adminView());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "チームを抜ける" }));
    const dialog = await screen.findByRole("dialog", { name: "飲食チームを抜けますか？" });
    expect(within(dialog).getByText(/抜ける前に、管理者を引き継ぐ人を選んでください/)).toBeInTheDocument();
    const go = within(dialog).getByRole("button", { name: "引き継いで抜ける" });
    expect(go).toBeDisabled();
    await user.click(within(dialog).getByRole("radio", { name: /鈴木 花子/ }));
    expect(go).toBeEnabled();
    await user.click(go);
    expect(mocks.leaveTeam).toHaveBeenCalledWith("t1", "u-s");
  });

  it("管理者しかいなければ、抜けるダイアログでチームの削除を案内する", async () => {
    const t = adminView();
    mocks.getTeam.mockResolvedValue({ ...t, members: [t.members[0]!] });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "チームを抜ける" }));
    const dialog = await screen.findByRole("dialog", { name: "飲食チームを抜けますか？" });
    expect(within(dialog).getByText(/チームにはあなたしかいません/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "チームを削除する" }));
    expect(await screen.findByRole("dialog", { name: "飲食チームを削除しますか？" })).toBeInTheDocument();
  });

  it("「⋯」の「チームから外す」（確認・赤）と「管理者を引き継ぐ」（T035）", async () => {
    mocks.getTeam.mockResolvedValue(adminView());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "山口 誠さんの操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "チームから外す" }));
    const remove = await screen.findByRole("dialog", { name: "山口 誠さんをチームから外しますか？" });
    expect(within(remove).getByText(/担当もなくなります/)).toBeInTheDocument();
    await user.click(within(remove).getByRole("button", { name: "外す" }));
    expect(mocks.removeMember).toHaveBeenCalledWith("t1", "u-y");

    await user.click(await screen.findByRole("button", { name: "佐藤 美咲さんの操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "管理者を引き継ぐ" }));
    const transfer = await screen.findByRole("dialog", { name: "管理者を佐藤 美咲さんに引き継ぎますか？" });
    await user.click(within(transfer).getByRole("button", { name: "引き継ぐ" }));
    expect(mocks.transferAdmin).toHaveBeenCalledWith("t1", "u-e");
  });
});

describe("チームの画面（メンバー・編集者）", () => {
  it("「管理者：・あなたのロール：」と「チームを抜ける」だけ。招待・担当・ロールの切り替え・⋯・ロールについては出ない", async () => {
    mocks.getTeam.mockResolvedValue(memberView());
    renderPage();
    expect(await screen.findByText(/管理者：田中 健 · あなたのロール：メンバー/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "チームを抜ける" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "メンバーを招待" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "担当を決める" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /のロール$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /の操作$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ロールについて" })).not.toBeInTheDocument();
  });

  it("「あなたのアカウント」の「チームに見せる」のスイッチ（T029）", async () => {
    mocks.getTeam.mockResolvedValue(memberView());
    const user = userEvent.setup();
    renderPage();
    const sw = await screen.findByRole("switch", { name: "カフェ B店をチームに見せる" });
    expect(sw).toBeChecked();
    await user.click(sw);
    expect(mocks.setTeamShared).toHaveBeenCalledWith("t1", "a-s", false);
    // 最後の1つには「チームから外す」を出さない
    expect(screen.queryByRole("button", { name: "チームから外す" })).not.toBeInTheDocument();
  });

  it("「アカウントを足す」で、チームに入れていない自分のアカウントを足せる", async () => {
    mocks.getTeam.mockResolvedValue(memberView());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "アカウントを足す" }));
    const dialog = await screen.findByRole("dialog", { name: "アカウントを足す" });
    await user.click(within(dialog).getByRole("button", { name: /カフェ B店 2号店/ }));
    expect(mocks.addTeamAccount).toHaveBeenCalledWith("t1", "a-s2");
  });

  it("未接続のアカウントは足せず、「Threadsにつなぐと入れられます」と添える（specs/012 FR-050）", async () => {
    mocks.getTeam.mockResolvedValue(memberView());
    mocks.me.mockResolvedValue({
      ...meData,
      accounts: meData.accounts.map((a) =>
        a.id === "a-s2" ? { ...a, username: null, displayName: null, connectionStatus: "not_connected" as const } : a,
      ),
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "アカウントを足す" }));
    const dialog = await screen.findByRole("dialog", { name: "アカウントを足す" });
    const row = within(dialog).getByRole("button", { name: /カフェ B店 2号店/ });
    expect(row).toBeDisabled();
    expect(row).toHaveTextContent("Threadsにつなぐと入れられます");
  });

  it("「チームを抜ける」：確認してから抜け、最初の画面へ戻る", async () => {
    mocks.getTeam.mockResolvedValue(memberView());
    const user = userEvent.setup();
    const router = renderPage();
    await user.click(await screen.findByRole("button", { name: "チームを抜ける" }));
    const dialog = await screen.findByRole("dialog", { name: "飲食チームを抜けますか？" });
    expect(within(dialog).getByText(/あなたのものとして残ります/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "抜ける" }));
    expect(mocks.leaveTeam).toHaveBeenCalledWith("t1", undefined);
    expect(await screen.findByText("最初の画面")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("チームの人でなければ「チームが見つかりません」", async () => {
    mocks.getTeam.mockRejectedValue(new ApiError("TEAM_NOT_FOUND", 404));
    renderPage();
    expect(await screen.findByText("チームが見つかりません。")).toBeInTheDocument();
  });
});

describe("運用状況のボタンと見える範囲（specs/020 T014・T023・T031）", () => {
  it("statusVisible なら「担当を決める」の前に「運用状況」。止まっている数の印が付き、押すと運用状況の画面へ", async () => {
    mocks.getTeam.mockResolvedValue(adminView());
    const user = userEvent.setup();
    const router = renderPage();
    const link = await screen.findByRole("link", { name: /運用状況/ });
    expect(link).toHaveAttribute("href", "/teams/t1/status");
    expect(await within(link).findByText("3")).toBeInTheDocument();
    const links = screen.getAllByRole("link").map((l) => l.textContent);
    expect(links.findIndex((t) => t?.includes("運用状況"))).toBeLessThan(links.indexOf("担当を決める"));
    await user.click(link);
    expect(router.state.location.pathname).toBe("/teams/t1/status");
  });

  it("止まっている数が0なら印を付けない", async () => {
    mocks.getTeam.mockResolvedValue(adminView());
    mocks.teamStatus.mockResolvedValue({ scope: "all", generatedAt: "", stoppedCount: 0, people: [], accounts: [] });
    renderPage();
    const link = await screen.findByRole("link", { name: /運用状況/ });
    await vi.waitFor(() => expect(mocks.teamStatus).toHaveBeenCalled());
    expect(link.textContent).toBe("運用状況");
  });

  it("statusVisible でなければ、ボタンも運用状況の読み込みも出さない（メンバー）", async () => {
    mocks.getTeam.mockResolvedValue(memberView());
    renderPage();
    expect(await screen.findByRole("heading", { name: "飲食チーム" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /運用状況/ })).not.toBeInTheDocument();
    expect(mocks.teamStatus).not.toHaveBeenCalled();
  });

  it("閉じたトグル「チームで見えること」は全員に出て、開くと3つの箇条書き", async () => {
    mocks.getTeam.mockResolvedValue(memberView());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "チームで見えること" }));
    const help = screen.getByRole("list", { name: "チームで見えること" });
    expect(within(help).getAllByRole("listitem")).toHaveLength(3);
    expect(within(help).getByText(/管理者と、担当の編集者は、運用状況/)).toBeInTheDocument();
  });
});
