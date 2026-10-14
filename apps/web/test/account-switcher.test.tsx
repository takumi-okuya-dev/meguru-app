import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, MeResponse, NeedsReviewCountsResponse } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageHeader } from "@/components/layout/PageHeader";
import { queryKeys } from "@/lib/query";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  needsReviewCounts: vi.fn(),
  account: vi.fn(),
  openAccount: vi.fn(),
  getDraftCounts: vi.fn(),
}));
vi.mock("@clerk/react", () => ({
  useUser: () => ({
    user: { fullName: "User", primaryEmailAddress: { emailAddress: "user@example.com" } },
  }),
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    api: {
      ...original.api,
      me: mocks.me,
      needsReviewCounts: mocks.needsReviewCounts,
      account: mocks.account,
      openAccount: mocks.openAccount,
      getDraftCounts: mocks.getDraftCounts,
    },
  };
});

const { AccountSwitcher, groupHeading } = await import("@/components/layout/AccountSwitcher");
const { AccountLayout, useCurrentAccount } = await import("@/pages/account-layout");

const account = (
  id: string,
  connectionStatus: AccountSummary["connectionStatus"] = "connected",
): AccountSummary => ({
  id,
  name: `Account ${id}`,
  username: `user_${id}`,
  displayName: `Account ${id}`,
  profilePictureUrl: null,
  plan: "multi-account",
  connectionStatus,
  lastUsedAt: null,
  role: "owner" as const,
  ownerName: null,
});

const accounts = [account("a1"), account("a2"), account("a3")];
const me = (rows: AccountSummary[]): MeResponse => ({
  user: { id: "user", email: "user@example.com", displayName: "User" },
  accounts: rows,
  landingAccountId: rows[0]?.id ?? null,
  accountLimit: { max: 5, used: rows.length },
  threadsAccessMode: "testers",
  teams: [],
});
const counts = (rows: [string, number][]): NeedsReviewCountsResponse => ({
  counts: rows.map(([accountId, needsReview]) => ({ accountId, needsReview })),
});

function renderSwitcher(
  initial = "/accounts/a1",
  onNavigate?: () => void,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const router = createMemoryRouter(
    [
      { path: "/accounts/:accountId", element: <AccountSwitcher onNavigate={onNavigate} /> },
      { path: "/accounts/new", element: <p>追加画面</p> },
    ],
    { initialEntries: [initial] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function StockFixture() {
  const current = useCurrentAccount();
  return <p>投稿: {current.id === "a1" ? "Aの投稿" : "Bの投稿"}</p>;
}

function SettingsFixture() {
  const current = useCurrentAccount();
  return <p>設定: {current.id === "a1" ? "Aの設定" : "Bの設定"}</p>;
}

function HomeFixture() {
  const current = useCurrentAccount();
  return (
    <>
      <PageHeader title="ホーム" />
      <p>
        ホーム: {current.id} / {current.connectionStatus}
      </p>
    </>
  );
}

function renderAccountRoutes() {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: <AccountLayout />,
        children: [
          { index: true, element: <HomeFixture /> },
          { path: "stock", element: <StockFixture /> },
          { path: "settings", element: <SettingsFixture /> },
        ],
      },
      { path: "/accounts/new", element: <p>追加画面</p> },
    ],
    { initialEntries: ["/accounts/a1/stock"] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Accountを切り替える" }));
  return screen.findByRole("menu");
}

describe("AccountSwitcherの横断要確認件数", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.me.mockResolvedValue(me(accounts));
    mocks.needsReviewCounts.mockResolvedValue(
      counts([
        ["a1", 5],
        ["a2", 2],
        ["a3", 0],
      ]),
    );
    mocks.account.mockImplementation(async (id: string) => accounts.find((a) => a.id === id));
    mocks.openAccount.mockImplementation(async (id: string) => accounts.find((a) => a.id === id));
    mocks.getDraftCounts.mockResolvedValue({
      needsReview: 0,
      approved: 0,
      rejected: 0,
      published: 0,
      publishFailed: 0,
    });
  });

  it("メニューを開くと最新一覧の3件に5・2・0件を表示し、Accountホームへ移れる", async () => {
    const router = renderSwitcher();
    const menu = await openMenu();
    expect(await within(menu).findByText("要確認 5件")).toBeInTheDocument();
    expect(within(menu).getByText("要確認 2件")).toBeInTheDocument();
    expect(within(menu).getByText("要確認 0件")).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Account a2/ }));
    expect(router.state.location.pathname).toBe("/accounts/a2");
    expect(mocks.me).toHaveBeenCalledTimes(2); // 初期表示と開いたときの再取得
    expect(mocks.needsReviewCounts).toHaveBeenCalledTimes(1);
  });

  it("件数取得が失敗しても0件にせず、切り替えと追加を利用できる", async () => {
    mocks.needsReviewCounts.mockRejectedValue(new Error("network"));
    const router = renderSwitcher();
    const menu = await openMenu();
    expect(await within(menu).findByText("件数を再試行")).toBeInTheDocument();
    expect(within(menu).getAllByText("取得できません")).toHaveLength(3);
    expect(within(menu).queryByText("要確認 0件")).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Account a2/ }));
    expect(router.state.location.pathname).toBe("/accounts/a2");
    const secondMenu = await openMenu();
    await userEvent.click(within(secondMenu).getByRole("menuitem", { name: /アカウントを追加/ }));
    expect(router.state.location.pathname).toBe("/accounts/new");
  });

  it("読み込み中は前回の数を表示せず、失敗から再試行できる", async () => {
    let finish: (value: NeedsReviewCountsResponse) => void = () => {};
    mocks.needsReviewCounts
      .mockImplementationOnce(
        () =>
          new Promise<NeedsReviewCountsResponse>((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        counts([
          ["a1", 4],
          ["a2", 2],
          ["a3", 0],
        ]),
      );
    renderSwitcher();
    let menu = await openMenu();
    expect(await within(menu).findAllByText("取得中")).toHaveLength(3);
    finish(
      counts([
        ["a1", 5],
        ["a2", 2],
        ["a3", 0],
      ]),
    );
    expect(await within(menu).findByText("要確認 5件")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    menu = await openMenu();
    expect(await within(menu).findByText("件数を再試行")).toBeInTheDocument();
    expect(within(menu).queryByText("要確認 5件")).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "件数を再試行" }));
    expect(await within(menu).findByText("要確認 4件")).toBeInTheDocument();
  });

  it("件数応答にIDがなければ一覧を再確認し、残る行の件数欠落を0件扱いしない", async () => {
    mocks.needsReviewCounts.mockResolvedValue(
      counts([
        ["a1", 5],
        ["a2", 2],
      ]),
    );
    renderSwitcher();
    const menu = await openMenu();
    expect(await within(menu).findByText("取得できません")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Account a3/ })).toHaveTextContent(
      "取得できません",
    );
    expect(mocks.me).toHaveBeenCalledTimes(3); // 初期表示、開いたとき、欠落時
  });

  it("開き直すたびに一覧と件数を取り直し、削除済みのAccountを残さない", async () => {
    renderSwitcher();
    let menu = await openMenu();
    expect(await within(menu).findByText("要確認 5件")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    mocks.me.mockResolvedValue(me(accounts.slice(0, 2)));
    mocks.needsReviewCounts.mockResolvedValue(
      counts([
        ["a1", 4],
        ["a2", 2],
      ]),
    );
    menu = await openMenu();
    await waitFor(() => expect(within(menu).getByText("要確認 4件")).toBeInTheDocument());
    expect(within(menu).queryByText("Account a3")).not.toBeInTheDocument();
    expect(mocks.needsReviewCounts).toHaveBeenCalledTimes(2);
  });

  it("先に始まった一覧の取得が後から終わっても、キャッシュを古い一覧に戻さない", async () => {
    let finishOld: (value: MeResponse) => void = () => {};
    mocks.me
      .mockImplementationOnce(
        () =>
          new Promise<MeResponse>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce(me(accounts));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderSwitcher("/accounts/a1", undefined, client);
    const menu = await openMenu();
    expect(await within(menu).findByText("要確認 5件")).toBeInTheDocument();
    finishOld(me([...accounts, account("deleted")]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getQueryData<MeResponse>(queryKeys.me)?.accounts.map((a) => a.id)).toEqual([
      "a1",
      "a2",
      "a3",
    ]);
  });

  it("一覧の取り直し中に後から始まった取得があれば、メニューとキャッシュはその新しい一覧を使う", async () => {
    let finishMenu: (value: MeResponse) => void = () => {};
    let finishTracked: (value: MeResponse) => void = () => {};
    mocks.me
      .mockResolvedValueOnce(me(accounts))
      .mockImplementationOnce(
        () =>
          new Promise<MeResponse>((resolve) => {
            finishMenu = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<MeResponse>((resolve) => {
            finishTracked = resolve;
          }),
      );
    mocks.needsReviewCounts.mockResolvedValue(
      counts([
        ["a1", 5],
        ["a2", 2],
        ["a3", 0],
        ["added", 1],
      ]),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderSwitcher("/accounts/a1", undefined, client);
    await waitFor(() => expect(client.getQueryData(queryKeys.me)).toBeDefined());
    const menu = await openMenu();
    await waitFor(() => expect(mocks.me).toHaveBeenCalledTimes(2));
    void client.invalidateQueries({ queryKey: queryKeys.me, exact: true });
    await waitFor(() => expect(mocks.me).toHaveBeenCalledTimes(3));
    finishMenu(me(accounts));
    finishTracked(me([...accounts, account("added")]));
    expect(
      await within(menu).findByRole("menuitem", { name: /Account added/ }),
    ).toHaveTextContent("要確認 1件");
    expect(client.getQueryData<MeResponse>(queryKeys.me)?.accounts.map((a) => a.id)).toEqual([
      "a1",
      "a2",
      "a3",
      "added",
    ]);
  });

  it("先に始まった取り直しが失敗しても、後から始まった取得を取り消さずにその一覧を表示する", async () => {
    let failMenu: (error: Error) => void = () => {};
    let finishTracked: (value: MeResponse) => void = () => {};
    mocks.me
      .mockResolvedValueOnce(me(accounts))
      .mockImplementationOnce(
        () =>
          new Promise<MeResponse>((_, reject) => {
            failMenu = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<MeResponse>((resolve) => {
            finishTracked = resolve;
          }),
      );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderSwitcher("/accounts/a1", undefined, client);
    await waitFor(() => expect(client.getQueryData(queryKeys.me)).toBeDefined());
    const menu = await openMenu();
    await waitFor(() => expect(mocks.me).toHaveBeenCalledTimes(2));
    void client.invalidateQueries({ queryKey: queryKeys.me, exact: true });
    await waitFor(() => expect(mocks.me).toHaveBeenCalledTimes(3));
    failMenu(new Error("network"));
    finishTracked(me(accounts.slice(0, 2)));
    expect(await within(menu).findByText("要確認 2件")).toBeInTheDocument();
    expect(within(menu).queryByText("アカウントを読み込めません")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Account a3")).not.toBeInTheDocument();
    expect(mocks.me).toHaveBeenCalledTimes(3);
  });

  it("連続した開閉の古い応答で新しい件数を上書きしない", async () => {
    let finishOld: (value: NeedsReviewCountsResponse) => void = () => {};
    mocks.needsReviewCounts
      .mockImplementationOnce(
        () =>
          new Promise<NeedsReviewCountsResponse>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce(
        counts([
          ["a1", 4],
          ["a2", 2],
          ["a3", 0],
        ]),
      );
    renderSwitcher();
    let menu = await openMenu();
    expect(await within(menu).findAllByText("取得中")).toHaveLength(3);
    await userEvent.keyboard("{Escape}");
    menu = await openMenu();
    expect(await within(menu).findByText("要確認 4件")).toBeInTheDocument();
    finishOld(
      counts([
        ["a1", 5],
        ["a2", 2],
        ["a3", 0],
      ]),
    );
    await waitFor(() => expect(within(menu).getByText("要確認 4件")).toBeInTheDocument());
    expect(within(menu).queryByText("要確認 5件")).not.toBeInTheDocument();
  });
});

describe("AccountSwitcherの状態と操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.me.mockResolvedValue(me([account("a1"), account("a2", "needs_reconnect")]));
    mocks.needsReviewCounts.mockResolvedValue(
      counts([
        ["a1", 0],
        ["a2", 2],
      ]),
    );
    mocks.account.mockImplementation(async (id: string) =>
      account(id, id === "a2" ? "needs_reconnect" : "connected"),
    );
    mocks.openAccount.mockImplementation(async (id: string) =>
      account(id, id === "a2" ? "needs_reconnect" : "connected"),
    );
    mocks.getDraftCounts.mockResolvedValue({
      needsReview: 0,
      approved: 0,
      rejected: 0,
      published: 0,
      publishFailed: 0,
    });
  });

  it("表示中・要再接続・件数を文字で示し、要再接続のホームへ移れる", async () => {
    const router = renderSwitcher();
    const menu = await openMenu();
    const current = await within(menu).findByRole("menuitem", { name: /Account a1/ });
    expect(current).toHaveTextContent("表示中");
    expect(current).toHaveTextContent("要確認 0件");
    const reconnect = within(menu).getByRole("menuitem", { name: /Account a2/ });
    expect(reconnect).toHaveTextContent("要再接続");
    expect(reconnect).toHaveTextContent("要確認 2件");
    await userEvent.click(reconnect);
    expect(router.state.location.pathname).toBe("/accounts/a2");
  });

  it("20件の末尾と追加操作がメニューにあり、スクロール可能な高さを持つ", async () => {
    const many = Array.from({ length: 20 }, (_, i) => account(`a${i + 1}`));
    mocks.me.mockResolvedValue(me(many));
    mocks.needsReviewCounts.mockResolvedValue(counts(many.map((a) => [a.id, 0])));
    renderSwitcher();
    const menu = await openMenu();
    expect(await within(menu).findByRole("menuitem", { name: /Account a20/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /アカウントを追加/ })).toBeInTheDocument();
    expect(menu.className).toContain("overflow-y-auto");
    expect(menu.className).toContain("max-h-");
  });

  it("長い表示名でも件数と状態が残り、キーボードで追加へ進める", async () => {
    const long = {
      ...account("a2", "needs_reconnect"),
      // 主に出すのはアカウントの名前（specs/012）
      name: "とても長い表示名".repeat(12),
    };
    mocks.me.mockResolvedValue(me([account("a1"), long]));
    renderSwitcher();
    const menu = await openMenu();
    const row = await within(menu).findByRole("menuitem", { name: /とても長い表示名/ });
    expect(row).toHaveTextContent("要確認 2件");
    expect(row).toHaveTextContent("要再接続");
    await userEvent.keyboard("{End}");
    expect(within(menu).getByRole("menuitem", { name: /アカウントを追加/ })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("キーボードで一覧の再試行を選んでも、矢印キーで復旧したAccountへ進める", async () => {
    mocks.me
      .mockResolvedValueOnce(me([account("a1"), account("a2", "needs_reconnect")]))
      .mockRejectedValueOnce(new Error("network"));
    renderSwitcher();
    screen.getByRole("button", { name: "Accountを切り替える" }).focus();
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    await within(menu).findByRole("menuitem", { name: "再試行" });
    await userEvent.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: "再試行" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(await within(menu).findByText("要確認 2件")).toBeInTheDocument();
    expect(menu).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: /Account a1/ })).toHaveFocus();
  });

  it("キーボードで件数の再試行を選んでも、フォーカスがメニュー内に残る", async () => {
    mocks.needsReviewCounts.mockRejectedValueOnce(new Error("network"));
    renderSwitcher();
    screen.getByRole("button", { name: "Accountを切り替える" }).focus();
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    const retry = await within(menu).findByRole("menuitem", { name: "件数を再試行" });
    retry.focus();
    await userEvent.keyboard("{Enter}");
    expect(await within(menu).findByText("要確認 2件")).toBeInTheDocument();
    expect(menu).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard("{End}");
    expect(within(menu).getByRole("menuitem", { name: /アカウントを追加/ })).toHaveFocus();
  });

  it("ドロワーから行を選ぶとonNavigateを呼ぶ", async () => {
    const onNavigate = vi.fn();
    renderSwitcher("/accounts/a1", onNavigate);
    const menu = await openMenu();
    await userEvent.click(await within(menu).findByRole("menuitem", { name: /Account a2/ }));
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("メニューで一覧の取り直しが失敗しても、表示中の画面は差し替えずメニューで再試行できる", async () => {
    renderAccountRoutes();
    expect(await screen.findByText("投稿: Aの投稿")).toBeInTheDocument();
    await waitFor(() => expect(mocks.me).toHaveBeenCalledTimes(2)); // 初期表示と、開いた後の取り直し
    mocks.me.mockRejectedValueOnce(new Error("network"));
    const menu = await openMenu();
    expect(await within(menu).findByText("アカウントを読み込めません")).toBeInTheDocument();
    expect(screen.getByText("投稿: Aの投稿")).toBeInTheDocument();
    expect(screen.queryByText("読み込めませんでした")).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "再試行" }));
    expect(await within(menu).findByText("要確認 2件")).toBeInTheDocument();
  });

  it("AからBへ切り替えると、投稿・設定の画面コンテキストもBに変わる", async () => {
    const router = renderAccountRoutes();
    expect(await screen.findByText("投稿: Aの投稿")).toBeInTheDocument();
    const menu = await openMenu();
    await userEvent.click(await within(menu).findByRole("menuitem", { name: /Account a2/ }));
    expect(router.state.location.pathname).toBe("/accounts/a2");
    await waitFor(() => expect(mocks.account).toHaveBeenCalledWith("a2"));
    expect(await mocks.account.mock.results.at(-1)?.value).toMatchObject({
      connectionStatus: "needs_reconnect",
    });
    expect(await screen.findByRole("link", { name: "再接続" })).toHaveAttribute(
      "href",
      "/accounts/a2/settings",
    );
    await router.navigate("/accounts/a2/stock");
    expect(await screen.findByText("投稿: Bの投稿")).toBeInTheDocument();
    expect(screen.queryByText("投稿: Aの投稿")).not.toBeInTheDocument();
    await router.navigate("/accounts/a2/settings");
    expect(await screen.findByText("設定: Bの設定")).toBeInTheDocument();
    expect(screen.queryByText("設定: Aの設定")).not.toBeInTheDocument();
  });
});

describe("切り替えメニューの見出し（specs/011 T025）", () => {
  const make = (id: string, role: AccountSummary["role"]): AccountSummary => ({
    id,
    name: id,
    username: id,
    displayName: id,
    profilePictureUrl: null,
    plan: "auto-only",
    connectionStatus: "connected",
    lastUsedAt: null,
    role,
    ownerName: role === "owner" ? null : "鈴木 花子",
  });

  it("担当しているAccountがあるときだけ「自分のアカウント」「担当しているアカウント」に分ける", () => {
    const mixed = [make("a1", "owner"), make("a2", "editor"), make("a3", "editor")];
    expect(mixed.map((_, i) => groupHeading(mixed, i))).toEqual(["自分のアカウント", "担当しているアカウント", null]);
    const ownOnly = [make("a1", "owner"), make("a2", "owner")];
    expect(ownOnly.map((_, i) => groupHeading(ownOnly, i))).toEqual([null, null]);
    const helpOnly = [make("a2", "editor")];
    expect(groupHeading(helpOnly, 0)).toBe("担当しているアカウント");
  });
});
