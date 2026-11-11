// テスト用のグループの招待（specs/016-test-groups contracts/ui-routes.md 1、US1、T017）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TestInvitePreview } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

let signedIn = false;
const signOut = vi.fn(async () => undefined);
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
  useClerk: () => ({ signOut }),
}));
const previewTestInvite = vi.fn();
const joinTestGroup = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, previewTestInvite, joinTestGroup } };
});

const { ApiError, getTestAccessRequired, setTestAccessRequired } = await import("@/lib/api-client");
const { TestInvitePage } = await import("@/shell/pages/test-invite");

const TOKEN = "g_" + "a".repeat(43);

function preview(over: Partial<TestInvitePreview> = {}): TestInvitePreview {
  return { group: { name: "飲食の会" }, testVersion: true, full: false, viewer: null, ...over };
}

function renderAt() {
  const router = createMemoryRouter(
    [
      { path: "/test-invite/:token", element: <TestInvitePage /> },
      { path: "/sign-in", element: <p>ログイン画面</p> },
      { path: "/", element: <p>最初の画面</p> },
      { path: "/threads", element: <p>Threadsのホーム</p> },
    ],
    { initialEntries: [`/test-invite/${TOKEN}`] },
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
  for (const fn of [previewTestInvite, joinTestGroup, signOut]) fn.mockReset();
  setTestAccessRequired(false);
});

describe("グループの招待", () => {
  it("ログイン前：グループ名と注意の3行、「Googleで始める」でログインへ（戻り先はこのリンク）", async () => {
    previewTestInvite.mockResolvedValue(preview());
    const user = userEvent.setup();
    const router = renderAt();
    expect(await screen.findByRole("heading", { name: "テスト版に招待されています" })).toBeInTheDocument();
    expect(screen.getByText("グループ：飲食の会")).toBeInTheDocument();
    expect(screen.getByText("料金はかかりません")).toBeInTheDocument();
    expect(screen.getByText("投稿は、つないだThreadsアカウントに実際に投稿されます")).toBeInTheDocument();
    expect(screen.getByText("テスト版のデータは本番版へは引き継がれません")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Googleで始める" }));
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent(`/test-invite/${TOKEN}`)}`);
  });

  it("本番（testVersion: false）では、見出しを「（グループ名）に招待されています」にし、テスト版の注意を出さない（specs/019 FR-019）", async () => {
    previewTestInvite.mockResolvedValue(preview({ testVersion: false }));
    renderAt();
    expect(await screen.findByRole("heading", { name: "飲食の会に招待されています" })).toBeInTheDocument();
    expect(screen.queryByText("料金はかかりません")).toBeNull();
    expect(screen.queryByText(/テスト版/)).toBeNull();
    expect(screen.getByRole("button", { name: "Googleで始める" })).toBeInTheDocument();
  });

  it("ログイン前で定員なら、「Googleで始める」の代わりに定員の文", async () => {
    previewTestInvite.mockResolvedValue(preview({ full: true }));
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("このグループは定員に達しています");
    expect(screen.queryByRole("button", { name: "Googleで始める" })).not.toBeInTheDocument();
  });

  it("ログイン後：「参加する」を押すまで入らない。押したら入り、入れない印を下ろしてThreadsのホームへ（specs/028）", async () => {
    signedIn = true;
    setTestAccessRequired(true);
    previewTestInvite.mockResolvedValue(preview({ viewer: { state: "can_join" } }));
    joinTestGroup.mockResolvedValue({ groupId: "g1" });
    const user = userEvent.setup();
    const router = renderAt();
    await user.click(await screen.findByRole("button", { name: "参加する" }));
    expect(joinTestGroup).toHaveBeenCalledWith(TOKEN);
    expect(await screen.findByText("Threadsのホーム")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/threads");
    expect(getTestAccessRequired()).toBe(false);
  });

  it("押したときに定員になっていたら、文言を出してとどまる", async () => {
    signedIn = true;
    previewTestInvite.mockResolvedValue(preview({ viewer: { state: "can_join" } }));
    joinTestGroup.mockRejectedValue(new ApiError("TEST_GROUP_FULL", 409));
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole("button", { name: "参加する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("定員に達しています");
  });

  it("ログイン後で定員なら、定員の文だけ", async () => {
    signedIn = true;
    previewTestInvite.mockResolvedValue(preview({ full: true, viewer: { state: "full" } }));
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("このグループは定員に達しています");
    expect(screen.queryByRole("button", { name: "参加する" })).not.toBeInTheDocument();
  });

  it("すでにどこかのグループに入っていれば、グループ名と「アプリを開く」", async () => {
    signedIn = true;
    previewTestInvite.mockResolvedValue(preview({ viewer: { state: "already_member", groupName: "美容の会" } }));
    renderAt();
    expect(await screen.findByText("すでに美容の会に入っています。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "アプリを開く" })).toHaveAttribute("href", "/threads");
  });

  it("使えないリンクは「このリンクは使えません」", async () => {
    previewTestInvite.mockRejectedValue(new ApiError("TEST_INVITE_INVALID", 404));
    renderAt();
    expect(await screen.findByRole("heading", { name: "このリンクは使えません" })).toBeInTheDocument();
    expect(screen.getByText("招待してくれた方に、新しいリンクをもらってください。")).toBeInTheDocument();
  });
});
