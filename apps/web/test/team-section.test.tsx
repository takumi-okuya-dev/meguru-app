// このアカウントの設定の「チーム」の区分（specs/011-team-revision contracts/ui-routes.md「このアカウントの設定：チームの区分」、
// T020・T029・T036・T037）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountTeam, MeResponse } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_ACCESS, OWNER_ACCESS } from "./helpers/access";
import { ME_BILLING_OFF } from "./helpers/billing";

const accountTeam = vi.fn();
const setTeamShared = vi.fn();
const createTeam = vi.fn();
const me = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me } };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, me, accountTeam, setTeamShared, createTeam } };
});
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError, dismiss: vi.fn() } }));

const { TeamSection } = await import("@/apps/threads/components/team/TeamSection");

const TEAM_ACCESS = { ...OWNER_ACCESS, hasTeam: true, team: { id: "t1", name: "飲食チーム", myRole: "member" as const } };
const inTeam: AccountTeam = {
  team: { id: "t1", name: "飲食チーム", admin: { userId: "u-a", name: "田中 健" }, shared: false },
  owner: { userId: "o1", name: "鈴木 花子" },
  viewerUserId: "o1",
  assignees: [
    { userId: "e1", name: "佐藤 美咲", role: "editor" },
    { userId: "u-a", name: "田中 健", role: "admin" },
  ],
};
const meData: MeResponse = {
  user: { id: "o1", email: "o1@example.com", displayName: "鈴木 花子" },
  accounts: [
    {
      id: "a1",
      name: "カフェ B店",
      username: "cafe_b",
      displayName: "カフェ B店",
      profilePictureUrl: null,
      connectionStatus: "connected",
      lastUsedAt: null,
      role: "owner",
      ownerName: null,
    },
  ],
  landingAccountId: "a1",
  accountLimit: { max: 1, used: 1 },
  ...ME_BILLING_OFF,
  threadsAccessMode: "testers",
  threadsConnectMethods: ["app", "token"] as const,
  teams: [],
};

function renderSection(access = OWNER_ACCESS) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <TeamSection accountId="a1" access={access} /> },
      { path: "/threads/teams/:teamId", element: <p>チームの画面</p> },
      { path: "/threads/accounts/:accountId/settings", element: <p>設定の画面</p> },
    ],
    { initialEntries: ["/"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  for (const fn of [accountTeam, setTeamShared, createTeam, me, toastError]) fn.mockReset();
  me.mockResolvedValue(meData);
});

describe("TeamSection（チームに入っていないオーナー）", () => {
  it("「チームに入っていません」と「チームを作る」の1行だけ。チームの問い合わせはしない（Constitution 4.0.1 原則V）", async () => {
    renderSection();
    expect(screen.getByRole("heading", { name: "チーム" })).toBeInTheDocument();
    expect(screen.getByText("チームに入っていません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "チームを作る" })).toBeInTheDocument();
    expect(screen.queryByText("ロールと、できることを見る")).not.toBeInTheDocument();
    expect(accountTeam).not.toHaveBeenCalled();
  });

  it("「チームを作る」：名前（1〜50文字）と自分のアカウント（このアカウントが選ばれている）で作り、チームの画面へ移る", async () => {
    createTeam.mockResolvedValue({ teamId: "t-new" });
    const user = userEvent.setup();
    const router = renderSection();
    await user.click(screen.getByRole("button", { name: "チームを作る" }));
    const dialog = await screen.findByRole("dialog", { name: "チームを作る" });
    // 「作る」はスマートフォンの右上とPCの下の2つ（FormDialogFrame）。PCの方で確かめる
    const submit = within(dialog).getAllByRole("button", { name: "作る" }).at(-1)!;
    expect(submit).toBeDisabled();
    expect(await within(dialog).findByRole("checkbox")).toBeChecked();
    await user.type(within(dialog).getByLabelText("チーム名"), "あ".repeat(51));
    expect(within(dialog).getByText("1〜50文字（51/50）")).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await user.clear(within(dialog).getByLabelText("チーム名"));
    await user.type(within(dialog).getByLabelText("チーム名"), "飲食チーム");
    await user.click(submit);
    expect(createTeam).toHaveBeenCalledWith({ name: "飲食チーム", accountIds: ["a1"] });
    expect(await screen.findByText("チームの画面")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/threads/teams/t-new");
  });

  it("未接続のアカウントだけなら「先にThreadsにつないでください」で、選べず作れない（specs/012 FR-050・FR-051）", async () => {
    me.mockResolvedValue({
      ...meData,
      accounts: [{ ...meData.accounts[0]!, name: "カフェの公式", username: null, displayName: null, connectionStatus: "not_connected" }],
    });
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "チームを作る" }));
    const dialog = await screen.findByRole("dialog", { name: "チームを作る" });
    expect(await within(dialog).findByText(/先にThreadsにつないでください/)).toBeInTheDocument();
    const box = within(dialog).getByRole("checkbox", { name: "カフェの公式をチームに入れる" });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(within(dialog).getByText("Threadsにつなぐと入れられます")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("チーム名"), "飲食チーム");
    for (const b of within(dialog).getAllByRole("button", { name: "作る" })) expect(b).toBeDisabled();
    // 「Threadsとの接続」へ進む入口を添える（PR #15 のCodexレビュー）
    const link = within(dialog).getByRole("link", { name: "「カフェの公式」をThreadsにつなぐ" });
    expect(link).toHaveAttribute("href", "/threads/accounts/a1/settings#threads");
    await user.click(link);
    expect(screen.queryByRole("dialog", { name: "チームを作る" })).not.toBeInTheDocument();
  });

  it("未接続のアカウントが2つあるとき、つなぐリンクは開いた画面のアカウントを優先する（PR #15 のCodexレビュー）", async () => {
    const base = { ...meData.accounts[0]!, username: null, displayName: null, connectionStatus: "not_connected" as const };
    me.mockResolvedValue({
      ...meData,
      accounts: [
        { ...base, id: "a0", name: "カフェの公式" },
        { ...base, id: "a1", name: "カフェの公式" },
      ],
    });
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "チームを作る" }));
    const dialog = await screen.findByRole("dialog", { name: "チームを作る" });
    expect(await within(dialog).findByRole("link", { name: "「カフェの公式」をThreadsにつなぐ" })).toHaveAttribute(
      "href",
      "/threads/accounts/a1/settings#threads",
    );
  });

  it("担当の人には（チームに入っていなければ）何も出さない", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <TeamSection accountId="a1" access={{ ...EDITOR_ACCESS, team: null }} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TeamSection（チームに入っている）", () => {
  it("チーム名（チームの画面へ）・「チームに見せる」のスイッチ・このアカウントの担当（「あなた」）を出す", async () => {
    accountTeam.mockResolvedValue(inTeam);
    renderSection(TEAM_ACCESS);
    const link = await screen.findByRole("link", { name: /飲食チーム/ });
    expect(link).toHaveAttribute("href", "/threads/teams/t1");
    expect(screen.getByText("管理者：田中 健")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "このアカウントをチームに見せる" })).not.toBeChecked();
    expect(screen.getByText("チームの人には、名前だけが出ます")).toBeInTheDocument();
    const card = screen.getByLabelText("このアカウントの担当");
    expect(within(card).getByText("佐藤 美咲")).toBeInTheDocument();
    expect(within(card).getByText("鈴木 花子")).toBeInTheDocument();
    expect(within(card).getByText("あなた")).toBeInTheDocument();
  });

  it("「チームに見せる」を押すとすぐ切り替わり、失敗したら元に戻す", async () => {
    accountTeam.mockResolvedValue(inTeam);
    setTeamShared.mockRejectedValue(new Error("x"));
    const user = userEvent.setup();
    renderSection(TEAM_ACCESS);
    const sw = await screen.findByRole("switch", { name: "このアカウントをチームに見せる" });
    await user.click(sw);
    expect(setTeamShared).toHaveBeenCalledWith("t1", "a1", true);
    expect(toastError).toHaveBeenCalled();
    expect(await screen.findByRole("switch", { name: "このアカウントをチームに見せる" })).not.toBeChecked();
  });

  it("担当の人には見せるのスイッチを出さず、カードだけ（読むだけ）", async () => {
    accountTeam.mockResolvedValue({ ...inTeam, viewerUserId: "e1" });
    renderSection(EDITOR_ACCESS);
    expect(await screen.findByLabelText("このアカウントの担当")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("ロールの図：オーナーと、管理者・メンバー・編集者の関係。自分のロールに「あなた」（FR-056）", async () => {
    accountTeam.mockResolvedValue(inTeam);
    const user = userEvent.setup();
    renderSection(TEAM_ACCESS);
    await user.click(await screen.findByRole("button", { name: "ロールと、できることを見る" }));
    const figure = screen.getByRole("figure", { name: "チームのロールの図" });
    expect(within(figure).getByText("オーナー（アカウントの持ち主）")).toBeInTheDocument();
    for (const name of ["管理者", "メンバー", "編集者"]) expect(within(figure).getByText(name)).toBeInTheDocument();
    const current = within(figure).getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "true");
    expect(current).toHaveTextContent("メンバー");
    expect(current).toHaveTextContent("あなた");
  });
});
