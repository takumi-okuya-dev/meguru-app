// 招待の確認画面（specs/008-team-operations contracts/ui-routes.md「招待の確認」、research.md R7）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

const TOKEN = "p_" + "a".repeat(43);

function preview(viewer: Partial<InvitePreview["viewer"]> = {}): InvitePreview {
  return {
    kind: "partner",
    account: { displayName: "カフェ B店", username: "cafe_b_tokyo", profilePictureUrl: null },
    inviterName: "鈴木 花子",
    team: null,
    viewer: { status: "anonymous", accountId: null, needsTeamName: false, ...viewer },
  };
}

function renderAt() {
  const router = createMemoryRouter(
    [
      { path: "/invite/:token", element: <InvitePage /> },
      { path: "/sign-in", element: <p>ログイン画面</p> },
      { path: "/accounts/:id", element: <p>Accountのホーム</p> },
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
  me.mockResolvedValue({ user: { id: "u", email: "tanaka@example.com", displayName: "田中 健" }, accounts: [] });
});

describe("招待の確認画面", () => {
  it("ログインなしで確認でき、「Googleでログインして参加」でログインへ進む（戻り先つき）", async () => {
    previewInvite.mockResolvedValue(preview());
    const user = userEvent.setup();
    const router = renderAt();
    expect(await screen.findByText("鈴木 花子さんから、運用を手伝うパートナーとして招待されました")).toBeInTheDocument();
    expect(screen.getByText("カフェ B店")).toBeInTheDocument();
    expect(screen.getByText("このアカウントの料金は、鈴木 花子さんが払います。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Googleでログインして参加" }));
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent(`/invite/${TOKEN}`)}`);
  });

  it("初めてのパートナーはチーム名を入れて参加し、そのAccountのホームへ移る", async () => {
    signedIn = true;
    previewInvite.mockResolvedValue(preview({ status: "can_join", needsTeamName: true }));
    acceptInvite.mockResolvedValue({ kind: "partner", accountId: "a1" });
    const user = userEvent.setup();
    const router = renderAt();
    expect(await screen.findByText("田中 健 としてログイン中")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/チーム名（会社名）/), "A社");
    await user.click(screen.getByRole("button", { name: "参加する" }));
    expect(acceptInvite).toHaveBeenCalledWith(TOKEN, "A社");
    expect(await screen.findByText("Accountのホーム")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/accounts/a1");
  });

  it("参加済み・自分のAccountの文言", async () => {
    signedIn = true;
    previewInvite.mockResolvedValue(preview({ status: "already_member", accountId: "a1" }));
    renderAt();
    expect(await screen.findByText("すでに参加しています。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開く" })).toHaveAttribute("href", "/accounts/a1");
  });

  it("使えないリンクは理由と、新しいリンクを頼む案内を出す", async () => {
    previewInvite.mockRejectedValue(new ApiError("INVITE_INVALID", 404));
    renderAt();
    expect(await screen.findByRole("heading", { name: "このリンクは使えません" })).toBeInTheDocument();
    expect(screen.getByText(/招待した方に、新しいリンクを頼んでください。/)).toBeInTheDocument();
  });
});

describe("ログイン後の戻り先", () => {
  it("招待のURLだけを許し、それ以外は /", () => {
    expect(safeNext(`/invite/${TOKEN}`)).toBe(`/invite/${TOKEN}`);
    expect(safeNext("https://evil.example.com")).toBe("/");
    expect(safeNext("/accounts/a1")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
