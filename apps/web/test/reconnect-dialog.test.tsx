// US3：接続し直すときに方法を選ぶ（specs/010-token-account-add contracts/ui-routes.md「接続し直すのダイアログ」、FR-031・FR-041・FR-050）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary } from "@threads-grower/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_ACCESS, OWNER_ACCESS } from "./helpers/access";

const tokenConnect = vi.fn();
const connect = vi.fn();
const accountAccess = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      accountAccess,
      tokenConnect,
      connect,
      getPostingRules: vi.fn(() => new Promise(() => {})),
      getPostingSchedule: vi.fn(() => new Promise(() => {})),
      getAutoPost: vi.fn(() => new Promise(() => {})),
      accountTeam: vi.fn(() => new Promise(() => {})),
    },
  };
});
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() } }));

const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { AccountSettings } = await import("@/pages/account-settings");
const { reconnectBannerText } = await import("@/pages/account-layout");
const { ReconnectButton } = await import("@/components/ReconnectButton");

const TOKEN = "THAAG" + "y".repeat(60);

function makeAccount(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: "a1",
    username: "cafe_b",
    displayName: "Cafe B",
    profilePictureUrl: null,
    plan: "auto-grower",
    connectionStatus: "connected",
    lastUsedAt: null,
    role: "owner",
    ownerName: null,
    connectionMethod: "token",
    reconnectHint: null,
    ...overrides,
  };
}

function renderSettings(account: AccountSummary) {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: (
          <UnsavedChangesProvider>
            <Outlet context={{ account }} />
          </UnsavedChangesProvider>
        ),
        children: [{ path: "settings", element: <AccountSettings /> }],
      },
    ],
    { initialEntries: ["/accounts/a1/settings"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of [tokenConnect, connect, accountAccess, toastSuccess]) fn.mockReset();
  accountAccess.mockResolvedValue(OWNER_ACCESS);
});

describe("接続し直しのダイアログ（US3）", () => {
  it("設定に「今の接続」が出る", async () => {
    renderSettings(makeAccount());
    expect(await screen.findByText(/今の接続：自分のMetaアプリのトークン/)).toBeInTheDocument();
  });

  it("「接続し直す」で2つの選択と「今の接続」のラベル。トークンを選ぶと貼り付けの欄が出て、成功でトースト", async () => {
    tokenConnect.mockResolvedValue({ accountId: "a1", kind: "reconnect", username: "cafe_b", warnings: [] });
    const user = userEvent.setup();
    renderSettings(makeAccount());
    await user.click(await screen.findByRole("button", { name: "接続し直す" }));
    const dialog = await screen.findByRole("dialog", { name: "Threadsとの接続し直し" });
    expect(dialog).toHaveTextContent("@cafe_bの接続を更新します。投稿ストックや設定はそのまま残ります。");
    const tokenOption = within(dialog).getByRole("button", { name: /トークンを貼り付ける/ });
    expect(tokenOption).toHaveTextContent("今の接続");
    expect(within(dialog).getByRole("button", { name: /Threadsで許可する/ })).not.toHaveTextContent("今の接続");
    await user.click(tokenOption);
    await user.type(within(dialog).getByLabelText("アクセストークン"), TOKEN);
    await user.click(within(dialog).getByRole("button", { name: "接続し直す" }));
    expect(tokenConnect).toHaveBeenCalledWith({ mode: "reconnect", accountId: "a1", token: TOKEN });
    expect(toastSuccess).toHaveBeenCalledWith("接続し直しました");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("「Threadsで許可する」は001の流れ（認可の画面へ）", async () => {
    connect.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderSettings(makeAccount({ connectionMethod: "app" }));
    await user.click(await screen.findByRole("button", { name: "接続し直す" }));
    await user.click(screen.getByRole("button", { name: /Threadsで許可する/ }));
    expect(connect).toHaveBeenCalledWith({ mode: "reconnect", accountId: "a1" });
  });

  it("要再接続で短期トークンだった可能性があれば、その文を出す", async () => {
    renderSettings(makeAccount({ connectionStatus: "needs_reconnect", reconnectHint: "short_lived_token" }));
    expect(await screen.findByText(/短期トークンだった可能性があります/)).toBeInTheDocument();
  });

  it("削除の確認に、トークンのときだけ「Metaアプリ側のトークンは…」を添える（FR-050）", async () => {
    const user = userEvent.setup();
    renderSettings(makeAccount());
    await user.click(await screen.findByRole("button", { name: "Accountを削除" }));
    expect(await screen.findByText("Metaアプリ側のトークンは、必要なら自分で取り消してください。")).toBeInTheDocument();
  });

  it("パートナー・編集者には接続し直しの操作を出さない（FR-034）", async () => {
    accountAccess.mockResolvedValue(EDITOR_ACCESS);
    renderSettings(makeAccount({ role: "editor" }));
    await screen.findByRole("heading", { name: "このアカウントの設定" });
    expect(screen.queryByRole("button", { name: "接続し直す" })).not.toBeInTheDocument();
  });
});

describe("要再接続のバナー（FR-041）", () => {
  it("オーナー・トークンならトークン用、app なら001の文、パートナー・編集者はオーナーを待つ文", () => {
    expect(reconnectBannerText({ role: "owner", connectionMethod: "token" })).toBe(
      "トークンが使えなくなりました。新しいトークンを貼り付けて接続し直してください。",
    );
    expect(reconnectBannerText({ role: "owner", connectionMethod: "app" })).toMatch(/^Threadsとの接続が切れています。再接続するまで/);
    for (const role of ["partner", "editor"] as const) {
      expect(reconnectBannerText({ role, connectionMethod: "token" })).toMatch(/オーナーの再接続を待っています/);
    }
  });
});

describe("ReconnectButton（PR #12 のCodexレビュー）", () => {
  function renderButton(account: AccountSummary) {
    const router = createMemoryRouter(
      [
        {
          path: "/accounts/:accountId",
          element: <Outlet context={{ account }} />,
          children: [
            {
              index: true,
              element: (
                <>
                  <p>描画済み</p>
                  <ReconnectButton accountId={account.id} />
                </>
              ),
            },
          ],
        },
      ],
      { initialEntries: [`/accounts/${account.id}`] },
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  it("オーナーには出し、押すと接続し直しのダイアログが開く", async () => {
    renderButton(makeAccount());
    await userEvent.click(await screen.findByRole("button", { name: "再接続" }));
    expect(await screen.findByRole("dialog", { name: "Threadsとの接続し直し" })).toBeInTheDocument();
  });

  it("パートナー・編集者には出さない（トークンの入力欄を見せない）", async () => {
    for (const role of ["partner", "editor"] as const) {
      renderButton(makeAccount({ role }));
      await screen.findByText("描画済み");
      expect(screen.queryByRole("button", { name: "再接続" })).not.toBeInTheDocument();
      cleanup();
    }
  });
});
