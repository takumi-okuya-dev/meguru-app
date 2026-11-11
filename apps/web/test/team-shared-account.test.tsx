// 見せてもらっているアカウント（/teams/:teamId/accounts/:accountId。specs/011-team-revision contracts/ui-routes.md
// 「見せてもらっているアカウント」、T030、FR-031）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyStrategyValues, type AccountAccessResponse } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_ACCESS, VIEWER_ACCESS } from "./helpers/access";

const mocks = vi.hoisted(() => ({
  accountAccess: vi.fn(),
  account: vi.fn(),
  getTeam: vi.fn(),
  listPostDrafts: vi.fn(),
  listPublished: vi.fn(),
  getStrategy: vi.fn(),
  listPromotions: vi.fn(),
  listReferencePosts: vi.fn(),
  listResearchKeywords: vi.fn(),
}));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { ApiError } = await import("@/lib/api-client");
const { TeamSharedAccountPage } = await import("@/apps/threads/pages/team-shared-account");

const draft = (id: string, body: string, status: "approved" | "needs_review") => ({
  id,
  batchId: "b",
  position: 0,
  body,
  status,
  version: 1,
  reviewedAt: null,
  rejectReasons: null,
  rejectNote: null,
  createdAt: "2026-10-13T00:00:00Z",
  updatedAt: "2026-10-13T00:00:00Z",
});

function renderPage(path = "/threads/teams/team-1/accounts/acc-1") {
  const router = createMemoryRouter(
    [
      { path: "/threads/teams/:teamId/accounts/:accountId", element: <TeamSharedAccountPage /> },
      { path: "/threads/teams/:teamId", element: <p>チームの画面</p> },
      { path: "/threads/accounts/:accountId", element: <p>Accountの画面</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

let access: AccountAccessResponse;
beforeEach(() => {
  for (const fn of [...Object.values(mocks), ...Object.values(toast)]) fn.mockReset();
  access = VIEWER_ACCESS;
  mocks.accountAccess.mockImplementation(() => Promise.resolve(access));
  mocks.account.mockResolvedValue({
    id: "acc-1",
    name: "さくらのパン日記",
    username: "sakura_pan",
    displayName: "さくらのパン日記",
    profilePictureUrl: null,
    connectionStatus: "connected",
    lastUsedAt: null,
    role: "viewer",
    ownerName: "鈴木 花子",
  });
  mocks.getTeam.mockResolvedValue({ id: "team-1", name: "飲食チーム", myRole: "member", admin: { userId: "u", name: "田中 健" }, members: [], limits: { members: 50, editors: 10 } });
  mocks.listPostDrafts.mockResolvedValue({
    needsReview: [draft("d2", "要確認の案", "needs_review")],
    approved: [draft("d1", "朝いちばんの焼き上がりの話", "approved")],
    publishFailed: [],
    rejected: [],
    schedule: {},
  });
  mocks.listPublished.mockResolvedValue({ items: [], nextCursor: null });
  mocks.getStrategy.mockResolvedValue({ ...emptyStrategyValues(), finalAction: "来店してもらう", version: 1, filledCount: 1, totalCount: 16, updatedAt: null, canEdit: false });
  mocks.listPromotions.mockResolvedValue({ items: [{ id: "p1", title: "季節のパン", content: "春の新作" }] });
  mocks.listReferencePosts.mockResolvedValue({ items: [] });
  mocks.listResearchKeywords.mockResolvedValue({ items: [{ id: "k1", keyword: "パン屋" }] });
});

describe("見せてもらっているアカウント", () => {
  it("上部の帯（読むだけ・チーム名・チームに戻る）と、アカウント・オーナー。投稿ストックを読むだけで操作のボタンは出ない", async () => {
    renderPage();
    expect(await screen.findByRole("status")).toHaveTextContent("鈴木 花子さんのアカウントを見ています（読むだけ） · 飲食チーム");
    expect(screen.getByRole("link", { name: "チームに戻る" })).toHaveAttribute("href", "/threads/teams/team-1");
    expect(screen.getByRole("heading", { name: "さくらのパン日記" })).toBeInTheDocument();
    expect(screen.getByText("@sakura_pan · オーナー 鈴木 花子")).toBeInTheDocument();
    expect(await screen.findByText("朝いちばんの焼き上がりの話")).toBeInTheDocument();
    // 状態のチップ（承認済み など）のほかに、操作のボタンはない
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["投稿ストック", "戦略", "承認済み", "投稿済み", "要確認"]);
    for (const name of [/パフォーマンス/, /設定/, /操作の記録/]) expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
  });

  it("アプリの画面なので、本番以外でも環境の帯は出さない（specs/015 contracts/ui-routes.md 1。2026-10-31）", async () => {
    vi.stubEnv("VITE_APP_ENV", "staging");
    renderPage();
    await screen.findByText(/さんのアカウントを見ています/);
    expect(screen.queryByText(/テスト環境です/)).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("状態のチップで絞る（承認済み・投稿済み・要確認）", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("朝いちばんの焼き上がりの話");
    await user.click(screen.getByRole("button", { name: "要確認" }));
    expect(screen.getByText("要確認の案")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "投稿済み" }));
    expect(await screen.findByText("この状態の投稿はありません。")).toBeInTheDocument();
  });

  it("戦略のタブ：課題・宣伝内容・リサーチを読むだけ", async () => {
    renderPage("/threads/teams/team-1/accounts/acc-1?tab=strategy");
    expect(await screen.findByText("来店してもらう")).toBeInTheDocument();
    expect(await screen.findByText("春の新作")).toBeInTheDocument();
    expect(await screen.findByText("パン屋")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("投稿済みの読み込みに失敗したら、「ありません」と出さずに失敗と再読み込みを出す（PR #14 のCodexレビュー）", async () => {
    mocks.listPublished.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500)).mockResolvedValue({ items: [], nextCursor: null });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("朝いちばんの焼き上がりの話");
    await user.click(screen.getByRole("button", { name: "投稿済み" }));
    expect(await screen.findByText("読み込めませんでした。")).toBeInTheDocument();
    expect(screen.queryByText("この状態の投稿はありません。")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByText("この状態の投稿はありません。")).toBeInTheDocument();
  });

  it("戦略のタブで宣伝内容・リサーチの読み込みに失敗したら、「まだありません」と出さずに失敗を出す（PR #14 のCodexレビュー）", async () => {
    mocks.listPromotions.mockRejectedValue(new ApiError("INTERNAL_ERROR", 500));
    mocks.listReferencePosts.mockRejectedValue(new ApiError("INTERNAL_ERROR", 500));
    renderPage("/threads/teams/team-1/accounts/acc-1?tab=strategy");
    expect(await screen.findByText("来店してもらう")).toBeInTheDocument();
    expect(await screen.findAllByText("読み込めませんでした。")).toHaveLength(2);
    expect(screen.queryByText("まだありません。")).not.toBeInTheDocument();
  });

  it("見られなくなったら「このアカウントを見られなくなりました」と出して、チームの画面へ移す", async () => {
    mocks.listPostDrafts.mockRejectedValue(new ApiError("ACCOUNT_NOT_FOUND", 404));
    renderPage();
    expect(await screen.findByText("チームの画面")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("このアカウントを見られなくなりました", { id: "shared-account-lost" });
  });

  it("担当の人・オーナーは、ふつうのAccountの画面へ移す", async () => {
    access = EDITOR_ACCESS;
    renderPage();
    expect(await screen.findByText("Accountの画面")).toBeInTheDocument();
  });
});
