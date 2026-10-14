// US1・US6：アカウントを作る画面（specs/012 FR-001〜FR-006、contracts/ui-routes.md「アカウントを作る」）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, MeResponse } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ me: vi.fn(), createAccount: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me: mocks.me, createAccount: mocks.createAccount, needsReviewCounts: vi.fn(() => new Promise(() => {})) } };
});
vi.mock("@clerk/react", () => ({ useUser: () => ({ user: null }), useClerk: () => ({ signOut: vi.fn() }) }));

const { AccountNew } = await import("@/pages/account-new");
const { takeInviteReturn } = await import("@/lib/invite-return");
const INVITE = `/invite/t_${"a".repeat(43)}`;

function account(id: string): AccountSummary {
  return {
    id,
    name: `アカウント${id}`,
    username: `user_${id}`,
    displayName: null,
    profilePictureUrl: null,
    plan: "auto-only",
    connectionStatus: "connected",
    lastUsedAt: null,
    role: "owner",
    ownerName: null,
  };
}

function me(max: number, used: number, threadsAccessMode: "testers" | "public" = "testers"): MeResponse {
  return {
    user: { id: "u", email: "u@example.com", displayName: null },
    accounts: Array.from({ length: used }, (_, i) => account(`a${i}`)),
    landingAccountId: used > 0 ? "a0" : null,
    accountLimit: { max, used },
    threadsAccessMode,
    teams: [],
  };
}

function renderAt(path = "/accounts/new") {
  const router = createMemoryRouter(
    [
      { path: "/accounts/new", element: <AccountNew /> },
      { path: "/accounts/:accountId", element: <p>ホームの画面</p> },
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

beforeEach(() => {
  mocks.me.mockReset();
  mocks.createAccount.mockReset();
  sessionStorage.clear();
});

describe("アカウントを作る画面", () => {
  it("はじめての人：名前の欄と「作る」だけ。Threadsへの接続の操作と件数は出さない（FR-001、US1-1）", async () => {
    mocks.me.mockResolvedValue(me(1, 0));
    renderAt();
    expect(await screen.findByRole("heading", { name: "アカウントを作る" })).toBeInTheDocument();
    expect(screen.getByLabelText("アカウントの名前")).toBeInTheDocument();
    expect(screen.getByText("Threadsには、あとで「このアカウントの設定」からつなげます。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Threadsアカウントを接続|Threadsで許可する/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/トークン/)).not.toBeInTheDocument();
    expect(screen.queryByText(/招待されたThreadsアカウントのみ/)).not.toBeInTheDocument();
    expect(screen.queryByText(/登録済み/)).not.toBeInTheDocument();
  });

  it("空・空白だけでは「作る」を押せない（US1-3）", async () => {
    mocks.me.mockResolvedValue(me(1, 0));
    renderAt();
    const button = await screen.findByRole("button", { name: "作る" });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText("アカウントの名前"), "   ");
    expect(button).toBeDisabled();
  });

  it("名前を入れて作ると、前後の空白を除いて送り、そのアカウントのホームへ移る（US1-2、FR-006）", async () => {
    mocks.me.mockResolvedValue(me(1, 0));
    mocks.createAccount.mockResolvedValue({ ...account("acc-1"), connectionStatus: "not_connected", username: null });
    const router = renderAt();
    await userEvent.type(await screen.findByLabelText("アカウントの名前"), " カフェの公式 ");
    await userEvent.click(screen.getByRole("button", { name: "作る" }));
    expect(mocks.createAccount).toHaveBeenCalledWith({ name: "カフェの公式" });
    expect(await screen.findByText("ホームの画面")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/accounts/acc-1");
  });

  it("上限に達していれば、名前の欄の代わりに上限の案内（001 FR-017、US6-3）", async () => {
    mocks.me.mockResolvedValue(me(1, 1));
    renderAt();
    expect(await screen.findByText(/プラン3にすると最大5件まで登録できます/)).toBeInTheDocument();
    expect(screen.queryByLabelText("アカウントの名前")).not.toBeInTheDocument();
  });

  it("作る途中で上限になったら、案内に切り替える", async () => {
    mocks.me.mockResolvedValue(me(5, 4));
    const { ApiError } = await import("@/lib/api-client");
    mocks.createAccount.mockRejectedValue(new ApiError("ACCOUNT_LIMIT_REACHED", 409));
    renderAt();
    await userEvent.type(await screen.findByLabelText("アカウントの名前"), "5つ目");
    await userEvent.click(screen.getByRole("button", { name: "作る" }));
    expect(await screen.findByText(/使っていないAccountを削除してください/)).toBeInTheDocument();
  });

  it("2つ目以降は「登録済み n/m件」を出す（US6）", async () => {
    mocks.me.mockResolvedValue(me(5, 2));
    renderAt();
    expect(await screen.findByText("登録済み 2/5件")).toBeInTheDocument();
  });

  it("招待のリンクから来たら、その招待を覚えておく（011 T019、specs/012 research.md R7）", async () => {
    mocks.me.mockResolvedValue(me(1, 0));
    renderAt(`/accounts/new?next=${encodeURIComponent(INVITE)}`);
    await screen.findByLabelText("アカウントの名前");
    expect(takeInviteReturn()).toBe(INVITE);
  });
});
