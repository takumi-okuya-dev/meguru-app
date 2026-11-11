// すべてのアプリ（/apps。specs/028-meguru-shell contracts/ui-routes.md 4、T047）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResponse } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "./helpers/billing";
import { WithEntryApp } from "./helpers/entry-app";

const mocks = vi.hoisted(() => ({ me: vi.fn(), toastError: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me: mocks.me } };
});

vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn(), dismiss: vi.fn() } }));

const { AppsPage } = await import("@/shell/pages/apps");

/**
 * /api/me の応答（apps だけを変える）。
 * @param apps - apps
 * @returns 応答
 */
function meWith(apps: MeResponse["apps"]): MeResponse {
  return {
    ...ME_BILLING_OFF,
    user: { id: "u1", email: "a@example.com", displayName: null },
    accounts: [],
    landingAccountId: null,
    accountLimit: { max: 3, used: 0 },
    threadsAccessMode: "public",
    threadsConnectMethods: ["app", "token"],
    teams: [],
    apps,
  };
}

/**
 * すべてのアプリの画面を描く。
 * @returns ルーター
 */
function renderApps() {
  const router = createMemoryRouter(
    [
      { path: "/apps", element: <AppsPage /> },
      { path: "/", element: <p>入口</p> },
      { path: "/threads", element: <p>Threadsのホーム</p> },
      { path: "/threads/accounts/new", element: <p>アカウントを作る</p> },
    ],
    { initialEntries: ["/apps"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WithEntryApp>
        <RouterProvider router={router} />
      </WithEntryApp>
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => mocks.me.mockReset());

describe("すべてのアプリの画面", () => {
  it("使っているアプリがなければ、「足せるアプリ」だけに、めぐる Threads を料金・「詳しく見る」・「使い始める」つきで出す", async () => {
    mocks.me.mockResolvedValue(meWith({ available: ["threads"], using: [], last: null, landing: null }));
    renderApps();
    expect(await screen.findByRole("heading", { name: "すべてのアプリ", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "使っているアプリ" })).toBeNull();
    const addable = screen.getByRole("region", { name: "足せるアプリ" });
    expect(within(addable).getByRole("heading", { name: "めぐる Threads" })).toBeInTheDocument();
    expect(within(addable).getByText("アカウント1件につき月1,000円")).toBeInTheDocument();
    expect(within(addable).getByRole("button", { name: "詳しく見る" })).toBeInTheDocument();
    expect(within(addable).getByRole("link", { name: "使い始める" })).toHaveAttribute("href", "/threads/accounts/new");
  });

  it("「詳しく見る」で説明が開き、画面は移らない", async () => {
    const user = userEvent.setup();
    mocks.me.mockResolvedValue(meWith({ available: ["threads"], using: [], last: null, landing: null }));
    const router = renderApps();
    const more = await screen.findByRole("button", { name: "詳しく見る" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/承認したものだけを、決めた時刻に自動で投稿します/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/apps");
  });

  it("「使い始める」で、Threadsのアカウントを作る画面へ移る", async () => {
    const user = userEvent.setup();
    mocks.me.mockResolvedValue(meWith({ available: ["threads"], using: [], last: null, landing: null }));
    renderApps();
    await user.click(await screen.findByRole("link", { name: "使い始める" }));
    expect(await screen.findByText("アカウントを作る")).toBeInTheDocument();
  });

  it("Threadsを使っていれば「使っているアプリ」に出て、「開く」でThreadsのホームへ。「足せるアプリ」は出さない", async () => {
    const user = userEvent.setup();
    mocks.me.mockResolvedValue(meWith({ available: ["threads"], using: ["threads"], last: "threads", landing: "threads" }));
    renderApps();
    const using = await screen.findByRole("region", { name: "使っているアプリ" });
    expect(within(using).queryByText("アカウント1件につき月1,000円")).toBeNull();
    expect(screen.queryByRole("region", { name: "足せるアプリ" })).toBeNull();
    await user.click(within(using).getByRole("link", { name: "開く" }));
    expect(await screen.findByText("Threadsのホーム")).toBeInTheDocument();
  });

  it("出せないアプリ・登録していないアプリは出さない", async () => {
    mocks.me.mockResolvedValue(meWith({ available: ["threads", "people"], using: [], last: null, landing: null }));
    renderApps();
    await screen.findByRole("heading", { name: "めぐる Threads" });
    expect(screen.getAllByRole("listitem").filter((li) => li.closest("section"))).toHaveLength(1);
  });

  it("「戻る」で、使っているアプリ（入口の行き先）のホームへ", async () => {
    const user = userEvent.setup();
    mocks.me.mockResolvedValue(meWith({ available: ["threads"], using: ["threads"], last: "threads", landing: "threads" }));
    renderApps();
    await user.click(await screen.findByRole("link", { name: "戻る" }));
    expect(await screen.findByText("Threadsのホーム")).toBeInTheDocument();
  });

  it("使っているアプリがなければ「戻る」は出さず（入口へ戻ってもここへ戻るだけ）、設定への道を出す", async () => {
    mocks.me.mockResolvedValue(meWith({ available: ["threads"], using: [], last: null, landing: null }));
    renderApps();
    await screen.findByRole("heading", { name: "めぐる Threads" });
    expect(screen.queryByRole("link", { name: "戻る" })).toBeNull();
    expect(screen.getByRole("link", { name: "設定" })).toHaveAttribute("href", "/settings");
  });

  it("?error=… つきで開いたら、エラーをトーストで出す", async () => {
    mocks.me.mockResolvedValue(meWith({ available: ["threads"], using: [], last: null, landing: null }));
    const router = createMemoryRouter([{ path: "/apps", element: <AppsPage /> }], { initialEntries: ["/apps?error=OAUTH_STATE_INVALID"] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WithEntryApp>
          <RouterProvider router={router} />
        </WithEntryApp>
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "めぐる Threads" });
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });
});
