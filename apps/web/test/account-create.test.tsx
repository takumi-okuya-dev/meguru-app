// US1・US6：アカウントを作る画面（specs/012 FR-001〜FR-006、contracts/ui-routes.md「アカウントを作る」）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, MeResponse } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF, meBilling } from "./helpers/billing";

const mocks = vi.hoisted(() => ({ me: vi.fn(), createAccount: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me: mocks.me } };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, createAccount: mocks.createAccount, needsReviewCounts: vi.fn(() => new Promise(() => {})) } };
});
vi.mock("@clerk/react", () => ({ useUser: () => ({ user: null }), useClerk: () => ({ signOut: vi.fn() }) }));

const { AccountNew } = await import("@/apps/threads/pages/account-new");
const { takeInviteReturn } = await import("@/lib/invite-return");
const INVITE = `/invite/t_${"a".repeat(43)}`;

function account(id: string): AccountSummary {
  return {
    id,
    name: `アカウント${id}`,
    username: `user_${id}`,
    displayName: null,
    profilePictureUrl: null,
    connectionStatus: "connected",
    lastUsedAt: null,
    role: "owner",
    ownerName: null,
  };
}

function me(
  max: number | null,
  used: number,
  threadsAccessMode: "testers" | "public" = "testers",
  billing: MeResponse["billing"] = ME_BILLING_OFF.billing,
): MeResponse {
  return {
    user: { id: "u", email: "u@example.com", displayName: null },
    accounts: Array.from({ length: used }, (_, i) => account(`a${i}`)),
    landingAccountId: used > 0 ? "a0" : null,
    accountLimit: { max, used },
    ...ME_BILLING_OFF,
    billing,
    threadsAccessMode,
    threadsConnectMethods: ["app", "token"],
    teams: [],
  };
}

function renderAt(path = "/threads/accounts/new") {
  const router = createMemoryRouter(
    [
      { path: "/threads/accounts/new", element: <AccountNew /> },
      { path: "/threads/accounts/:accountId", element: <p>ホームの画面</p> },
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
    expect(router.state.location.pathname).toBe("/threads/accounts/acc-1");
  });

  it("無料体験中で1件あれば、名前の欄の代わりに上限の案内と「契約する」（specs/013 US1-2）", async () => {
    mocks.me.mockResolvedValue(me(1, 1, "testers", meBilling("trial")));
    renderAt();
    expect(
      await screen.findByText("無料体験中に作れるアカウントは1件までです。契約すると、2件目からも作れます。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "契約する" })).toHaveAttribute("href", "/settings/billing");
    expect(screen.queryByLabelText("アカウントの名前")).not.toBeInTheDocument();
  });

  it("読むだけなら、理由と「契約する」か「支払いの画面を開く」を出す（specs/013 FR-043、Edge Cases：0件で体験が終わった人）", async () => {
    mocks.me.mockResolvedValue(me(0, 0, "testers", meBilling("read_only")));
    renderAt();
    expect(await screen.findByText(/無料体験が終わりました。今は読むだけです/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "契約する" })).toBeInTheDocument();
    expect(screen.queryByLabelText("アカウントの名前")).not.toBeInTheDocument();
    cleanup();
    mocks.me.mockResolvedValue(me(0, 1, "testers", meBilling("read_only", { readOnlyReason: "payment_failed" })));
    renderAt();
    expect(await screen.findByRole("link", { name: "支払いの画面を開く" })).toBeInTheDocument();
  });

  it("契約中の2件目からは、料金の案内を添える（specs/013 FR-031）", async () => {
    mocks.me.mockResolvedValue(me(null, 1, "testers", meBilling("active")));
    renderAt();
    expect(await screen.findByText("アカウント1件につき月1,000円です。次の請求から反映されます。")).toBeInTheDocument();
    expect(screen.getByLabelText("アカウントの名前")).toBeInTheDocument();
    expect(screen.getByText("登録済み 1件")).toBeInTheDocument();
  });

  it("作る途中で上限になったら、案内に切り替える（運営者の上限なら運営者への連絡。specs/024 FR-018）", async () => {
    mocks.me.mockResolvedValue(me(null, 0));
    const { ApiError } = await import("@/lib/api-client");
    mocks.createAccount.mockRejectedValue(new ApiError("ACCOUNT_LIMIT_REACHED", 409));
    renderAt();
    await userEvent.type(await screen.findByLabelText("アカウントの名前"), "2つ目");
    await userEvent.click(screen.getByRole("button", { name: "作る" }));
    expect(await screen.findByText(/増やしたいときは運営者に連絡してください/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "契約する" })).not.toBeInTheDocument();
  });

  it("2つ目以降は「登録済み n/m件」を出す（US6）", async () => {
    mocks.me.mockResolvedValue(me(5, 2));
    renderAt();
    expect(await screen.findByText("登録済み 2/5件")).toBeInTheDocument();
  });

  it("招待のリンクから来たら、その招待を覚えておく（011 T019、specs/012 research.md R7）", async () => {
    mocks.me.mockResolvedValue(me(1, 0));
    renderAt(`/threads/accounts/new?next=${encodeURIComponent(INVITE)}`);
    await screen.findByLabelText("アカウントの名前");
    expect(takeInviteReturn()).toBe(INVITE);
  });
});
