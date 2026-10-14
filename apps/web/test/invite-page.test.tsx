// 招待の確認画面（specs/011-team-revision contracts/ui-routes.md「招待の確認」、T019、FR-012〜FR-016）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InvitePreview } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

let signedIn = false;
const signOut = vi.fn(async () => undefined);
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
  useClerk: () => ({ signOut }),
}));
const previewInvite = vi.fn();
const acceptInvite = vi.fn();
const me = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, previewInvite, acceptInvite, me } };
});

const { ApiError } = await import("@/lib/api-client");
const { InvitePage } = await import("@/pages/invite");
const { safeNext } = await import("@/pages/sign-in");
const { isInvitePath } = await import("@/lib/invite-return");

const TOKEN = "t_" + "a".repeat(43);

const ACCOUNTS = [
  { id: "acc-1", name: "ベーカリー E", displayName: "ベーカリー E", username: "bakery_e", profilePictureUrl: null, connected: true, inOtherTeam: null },
  { id: "acc-2", name: "ベーカリー E 焼き菓子", displayName: "ベーカリー E 焼き菓子", username: "bakery_e_sweets", profilePictureUrl: null, connected: true, inOtherTeam: null },
  { id: "acc-3", name: "整体院 D", displayName: "整体院 D", username: "seitai_d", profilePictureUrl: null, connected: true, inOtherTeam: "美容チーム" },
];

function preview(viewer: Partial<InvitePreview["viewer"]> = {}): InvitePreview {
  return {
    team: { name: "飲食チーム", adminName: "田中 健", memberCount: 5 },
    viewer: { status: "anonymous", teamId: null, accounts: [], ...viewer },
  };
}

function renderAt() {
  const router = createMemoryRouter(
    [
      { path: "/invite/:token", element: <InvitePage /> },
      { path: "/sign-in", element: <p>ログイン画面</p> },
      { path: "/accounts/new", element: <p>アカウント追加</p> },
      { path: "/teams/:teamId", element: <p>チームの画面</p> },
      { path: "/", element: <p>最初の画面</p> },
    ],
    { initialEntries: [`/invite/${TOKEN}`] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  signedIn = false;
  for (const fn of [previewInvite, acceptInvite, me, signOut]) fn.mockReset();
  me.mockResolvedValue({ user: { id: "u", email: "yamaguchi@example.com", displayName: "山口 誠" }, accounts: [], teams: [] });
});

describe("招待の確認", () => {
  it("ログイン前：チーム名・管理者・人数と「メンバーとして入ります」、「Googleで続ける」でログインへ（戻り先はこのリンク）", async () => {
    previewInvite.mockResolvedValue(preview());
    const user = userEvent.setup();
    const router = renderAt();
    expect(await screen.findByRole("heading", { name: "「飲食チーム」に招待されています" })).toBeInTheDocument();
    expect(screen.getByText("管理者：田中 健 · 5人")).toBeInTheDocument();
    expect(screen.getByText("メンバーとして入ります")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Googleで続ける" }));
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(new URLSearchParams(router.state.location.search).get("next")).toBe(`/invite/${TOKEN}`);
  });

  it("needs_account：先にThreadsアカウントを追加するよう案内し、追加の画面へ（戻り先つき）", async () => {
    signedIn = true;
    previewInvite.mockResolvedValue(preview({ status: "needs_account" }));
    renderAt();
    expect(await screen.findByText("先に、自分のThreadsアカウントをつないでください")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Threadsアカウントを追加" })).toHaveAttribute(
      "href",
      `/accounts/new?next=${encodeURIComponent(`/invite/${TOKEN}`)}`,
    );
  });

  it("ready：アカウントを選ぶまで押せない。選んだアカウントごとに「チームに見せる」（初めはオフ）。ほかのチームのものは選べない", async () => {
    signedIn = true;
    previewInvite.mockResolvedValue(preview({ status: "ready", accounts: ACCOUNTS }));
    acceptInvite.mockResolvedValue({ teamId: "t1" });
    const user = userEvent.setup();
    const router = renderAt();
    const join = await screen.findByRole("button", { name: "アカウントを選んでください" });
    expect(join).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "整体院 Dをチームに入れる" })).toBeDisabled();
    expect(screen.getByText("美容チームに入っています")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "ベーカリー Eをチームに入れる" }));
    await user.click(screen.getByRole("checkbox", { name: "ベーカリー E 焼き菓子をチームに入れる" }));
    const share = screen.getByRole("switch", { name: "ベーカリー Eをチームに見せる" });
    expect(share).not.toBeChecked();
    await user.click(share);
    await user.click(screen.getByRole("button", { name: "2件のアカウントで参加する" }));
    expect(acceptInvite).toHaveBeenCalledWith(TOKEN, [
      { id: "acc-1", shared: true },
      { id: "acc-2", shared: false },
    ]);
    expect(await screen.findByText("チームの画面")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/teams/t1");
  });

  it("already_member：「すでにこのチームに入っています」と「チームを開く」", async () => {
    signedIn = true;
    previewInvite.mockResolvedValue(preview({ status: "already_member", teamId: "t1" }));
    renderAt();
    expect(await screen.findByText("すでにこのチームに入っています。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "チームを開く" })).toHaveAttribute("href", "/teams/t1");
  });

  it("無効なリンク（作り直した後の古いリンク・チームの削除の後）：「このリンクは使えません」", async () => {
    previewInvite.mockRejectedValue(new ApiError("INVITE_INVALID", 404));
    renderAt();
    expect(await screen.findByRole("heading", { name: "このリンクは使えません" })).toBeInTheDocument();
    expect(screen.getByText(/リンクが作り直されたか、チームが削除されました/)).toBeInTheDocument();
  });

  it("参加に失敗したら文言を出す（ほかのチームに入った・人数の上限）", async () => {
    signedIn = true;
    previewInvite.mockResolvedValue(preview({ status: "ready", accounts: ACCOUNTS }));
    acceptInvite.mockRejectedValue(new ApiError("TEAM_FULL", 409, ["members"]));
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole("checkbox", { name: "ベーカリー Eをチームに入れる" }));
    await user.click(screen.getByRole("button", { name: "1件のアカウントで参加する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("上限（50人）");
  });

  it("ロールの図に、入ったときのロール（メンバー）の「あなた」を付ける", async () => {
    previewInvite.mockResolvedValue(preview());
    renderAt();
    const figure = await screen.findByRole("figure", { name: "チームのロールの図" });
    const current = within(figure).getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "true");
    expect(current).toHaveTextContent("メンバー");
  });
});

describe("ログインの戻り先（safeNext）", () => {
  it("チームの招待リンク（t_）だけを許し、ほかは / にする", () => {
    expect(safeNext(`/invite/${TOKEN}`)).toBe(`/invite/${TOKEN}`);
    for (const bad of [null, "/accounts/x", "https://evil.example.com", `/invite/p_${"a".repeat(43)}`, `/invite/${TOKEN}/x`]) {
      expect(safeNext(bad)).toBe("/");
    }
    expect(isInvitePath(`/invite/${TOKEN}`)).toBe(true);
  });
});
