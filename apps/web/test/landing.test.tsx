// 「/」の振り分け（001 FR-004・FR-005）。specs/012 で、callback から `/?error=…` で戻されたときにエラーを出してから移るようにした
// （許可の画面にいる間にアカウントが消された・state が使えない。contracts/api.md、PR #15 のCodexレビュー）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { MeResponse } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "./helpers/billing";

const mocks = vi.hoisted(() => ({ me: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me: mocks.me } };
});
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError, dismiss: vi.fn() } }));

const { Landing } = await import("@/apps/threads/pages/home");

function me(landingAccountId: string | null): MeResponse {
  return {
    user: { id: "u", email: "u@example.com", displayName: null },
    accounts: [],
    landingAccountId,
    accountLimit: { max: 1, used: landingAccountId ? 1 : 0 },
    ...ME_BILLING_OFF,
    threadsAccessMode: "public",
    threadsConnectMethods: ["app", "token"] as const,
    teams: [],
  };
}

/** 一覧に入れる Account（行き先の判定に使う分だけ）。 */
function account(id: string): MeResponse["accounts"][number] {
  return {
    id,
    name: "アカウント",
    username: null,
    displayName: null,
    profilePictureUrl: null,
    connectionStatus: "not_connected",
    lastUsedAt: null,
    role: "owner",
    ownerName: null,
  };
}

function renderAt(path: string, cached?: MeResponse) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <Landing /> },
      { path: "/threads/accounts/new", element: <p>作る画面</p> },
      { path: "/threads/accounts/:id", element: <p>ホームの画面</p> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // 画面を開く前に読んであった（古いかもしれない）一覧
  if (cached) client.setQueryData(["me"], cached);
  render(
    <QueryClientProvider client={client}>
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
    expect(router.state.location.pathname).toBe("/threads/accounts/a1");
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

describe("古い一覧で行き先を決めない（消したアカウントへ戻らない）", () => {
  it("取り直している間は移らず、新しい一覧が届いてから決める", async () => {
    // 前に読んだ一覧には、もう消したアカウントが残っている
    const stale = { ...me("a-deleted"), accounts: [account("a-deleted")] };
    let finish: (v: MeResponse) => void = () => {};
    mocks.me.mockImplementation(() => new Promise<MeResponse>((r) => (finish = r)));
    const router = renderAt("/", stale);
    // 取り直しが終わるまで、消したアカウントへは移らない
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByText("ホームの画面")).not.toBeInTheDocument();
    await act(async () => finish(me(null)));
    await waitFor(() => expect(screen.getByText("作る画面")).toBeInTheDocument());
  });

  it("新しい一覧に残っているアカウントがあれば、そこへ移る", async () => {
    const stale = { ...me("a-old"), accounts: [account("a-old")] };
    mocks.me.mockResolvedValue({ ...me("a-new"), accounts: [account("a-new")] });
    renderAt("/", stale);
    expect(await screen.findByText("ホームの画面")).toBeInTheDocument();
  });
});
