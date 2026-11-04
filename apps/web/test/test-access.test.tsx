// テスト版に入れない人の画面（specs/016-test-groups contracts/ui-routes.md 2、T016）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "./helpers/billing";

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useClerk: () => ({ signOut: vi.fn(async () => undefined) }),
}));
const me = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me } };
});

const { RequireAuth } = await import("@/components/guards");
const { setTestAccessRequired } = await import("@/lib/api-client");

const ME = {
  user: { id: "u", email: "u@example.com", displayName: null },
  accounts: [],
  landingAccountId: null,
  accountLimit: { max: 1, used: 0 },
  threadsAccessMode: "testers" as const,
  threadsConnectMethods: ["token" as const],
  teams: [],
  ...ME_BILLING_OFF,
};

function renderAt() {
  const router = createMemoryRouter(
    [{ element: <RequireAuth />, children: [{ path: "/", element: <p>アプリの画面</p> }] }],
    { initialEntries: ["/"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  me.mockReset();
  setTestAccessRequired(false);
});

describe("テスト版に入れない人", () => {
  it("入れない印が立つと、アプリの画面の代わりに「招待された方だけ」とログアウトを出す", async () => {
    me.mockResolvedValue({ ...ME, testGroups: { enabled: true, admitted: false, operator: false } });
    renderAt();
    expect(screen.getByText("アプリの画面")).toBeInTheDocument();
    act(() => setTestAccessRequired(true));
    expect(await screen.findByRole("heading", { name: "テスト版は招待された方だけが使えます" })).toBeInTheDocument();
    expect(screen.getByText("届いた招待のリンクを、このブラウザで開き直してください。")).toBeInTheDocument();
    expect(screen.getByText("・ログインしたままで大丈夫です")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
    expect(screen.queryByText("アプリの画面")).not.toBeInTheDocument();
  });

  it("画面を開いたときに読み直し、入れるようになっていれば元の画面に戻る", async () => {
    me.mockResolvedValue({ ...ME, testGroups: { enabled: true, admitted: true, operator: false } });
    setTestAccessRequired(true);
    renderAt();
    expect(await screen.findByText("アプリの画面")).toBeInTheDocument();
  });

  it("OFFの環境（/api/me の testGroups.enabled が false）なら、元の画面に戻る", async () => {
    me.mockResolvedValue(ME);
    setTestAccessRequired(true);
    renderAt();
    expect(await screen.findByText("アプリの画面")).toBeInTheDocument();
  });
});
