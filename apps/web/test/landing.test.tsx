// 「/」の振り分け（001 FR-004・FR-005）。specs/012 で、callback から `/?error=…` で戻されたときにエラーを出してから移るようにした
// （許可の画面にいる間にアカウントが消された・state が使えない。contracts/api.md、PR #15 のCodexレビュー）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { MeResponse } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ me: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me: mocks.me } };
});
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError, dismiss: vi.fn() } }));

const { Landing } = await import("@/pages/landing");

function me(landingAccountId: string | null): MeResponse {
  return {
    user: { id: "u", email: "u@example.com", displayName: null },
    accounts: [],
    landingAccountId,
    accountLimit: { max: 1, used: landingAccountId ? 1 : 0 },
    threadsAccessMode: "public",
    teams: [],
  };
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <Landing /> },
      { path: "/accounts/new", element: <p>作る画面</p> },
      { path: "/accounts/:id", element: <p>ホームの画面</p> },
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
  toastError.mockReset();
  mocks.me.mockReset();
});

describe("「/」の振り分け", () => {
  it("?error= があれば、エラーの文言をトーストで出してから最後に使ったアカウントへ移る", async () => {
    mocks.me.mockResolvedValue(me("a1"));
    const router = renderAt("/?error=ACCOUNT_NOT_FOUND");
    expect(await screen.findByText("ホームの画面")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/accounts/a1");
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("見つかりません"));
  });

  it("アカウントがなければ、エラーを出してから「アカウントを作る」へ", async () => {
    mocks.me.mockResolvedValue(me(null));
    renderAt("/?error=OAUTH_STATE_INVALID");
    expect(await screen.findByText("作る画面")).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("?error= がなければ、トーストを出さない", async () => {
    mocks.me.mockResolvedValue(me("a1"));
    renderAt("/");
    expect(await screen.findByText("ホームの画面")).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });
});
