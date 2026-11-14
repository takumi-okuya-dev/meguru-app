// 契約前の画面（specs/024-tester-invite-connect contracts/ui-routes.md 1、FR-029、T031）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResponse } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF, meBilling, type MeWithThreads } from "./helpers/billing";

const mocks = vi.hoisted(() => ({ me: vi.fn(), startCheckout: vi.fn(), logout: vi.fn() }));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }) }));
vi.mock("@/lib/use-logout", () => ({ useLogout: () => mocks.logout }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me: mocks.me, startCheckout: mocks.startCheckout } };
});

const { RequireAuth } = await import("@/shell/guards/RequireAuth");
const { setSubscriptionRequired } = await import("@/lib/api-client");

const ME = (state: MeResponse["billing"]["state"]): MeWithThreads => ({
  user: { id: "u", email: "u@example.com", displayName: null },
  accounts: [],
  landingAccountId: null,
  accountLimit: { max: 0, used: 0 },
  threadsAccessMode: "testers",
  threadsConnectMethods: ["app", "token"],
  teams: [],
  ...ME_BILLING_OFF,
  billing: meBilling(state, state === "unsubscribed" ? { readOnlyReason: "not_subscribed", trialEndsAt: null } : {}),
});

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <RequireAuth />,
        children: [
          { path: "/threads/accounts", element: <p>アプリの中身</p> },
          { path: "/settings/billing", element: <p>契約と支払いの画面</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  act(() => setSubscriptionRequired(false));
});

describe("契約前の画面", () => {
  it("/api/me が unsubscribed なら、料金と「契約する」だけを出す。ログアウト・退会は下に", async () => {
    mocks.me.mockResolvedValue(ME("unsubscribed"));
    renderAt("/threads/accounts");
    await screen.findByText("アプリの中身");
    // me で契約前と分かると（api.me が印を立てる）、契約前の画面に替わる
    act(() => setSubscriptionRequired(true));
    expect(await screen.findByRole("heading", { name: "契約してから使い始めます" })).toBeInTheDocument();
    expect(screen.getByText("アカウント1件につき")).toBeInTheDocument();
    expect(screen.getByText("月1,000円")).toBeInTheDocument();
    expect(screen.getByText(/契約すると、すぐにアカウントを作れます/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "退会する" })).toHaveAttribute("href", "/settings/account");
    expect(screen.queryByText("アプリの中身")).not.toBeInTheDocument();
    expect(screen.queryByText(/無料体験/)).not.toBeInTheDocument();
  });

  it("「契約する」で支払いの画面へ移る", async () => {
    mocks.me.mockResolvedValue(ME("unsubscribed"));
    mocks.startCheckout.mockResolvedValue({ url: "https://checkout.example/cs_1" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    act(() => setSubscriptionRequired(true));
    renderAt("/threads/accounts");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "契約する" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.example/cs_1"));
    vi.unstubAllGlobals();
  });

  it("API が SUBSCRIPTION_REQUIRED を返しても、契約前の画面になる", async () => {
    mocks.me.mockResolvedValue(ME("unsubscribed"));
    act(() => setSubscriptionRequired(true));
    renderAt("/threads/accounts");
    expect(await screen.findByRole("heading", { name: "契約してから使い始めます" })).toBeInTheDocument();
  });

  it("契約と支払いの画面（Checkoutからの戻り先）は開ける", async () => {
    mocks.me.mockResolvedValue(ME("unsubscribed"));
    act(() => setSubscriptionRequired(true));
    renderAt("/settings/billing?checkout=success");
    expect(await screen.findByText("契約と支払いの画面")).toBeInTheDocument();
  });

  it("契約したら（active）元に戻る", async () => {
    mocks.me.mockResolvedValue(ME("active"));
    act(() => setSubscriptionRequired(true));
    renderAt("/threads/accounts");
    expect(await screen.findByText("アプリの中身")).toBeInTheDocument();
  });
});
