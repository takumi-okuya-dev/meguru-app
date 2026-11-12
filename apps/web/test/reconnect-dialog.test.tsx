// US3：接続し直すときに方法を選ぶ（specs/010-token-account-add contracts/ui-routes.md「接続し直すのダイアログ」、FR-031・FR-041・FR-050）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary } from "@meguru/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_ACCESS, OWNER_ACCESS } from "./helpers/access";

const tokenConnect = vi.fn();
const me = vi.fn();
const connect = vi.fn();
const accountAccess = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { ...actual.api, me },
  };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, accountAccess, tokenConnect, connect, getPostingRules: vi.fn(() => new Promise(() => {})), getPostingSchedule: vi.fn(() => new Promise(() => {})), getAutoPost: vi.fn(() => new Promise(() => {})), accountTeam: vi.fn(() => new Promise(() => {})), connectionNotice: vi.fn(() => Promise.resolve({ otherAccount: null })) } };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, warning: vi.fn(), dismiss: vi.fn() } }));

const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { AccountSettings } = await import("@/apps/threads/pages/account-settings");
const { reconnectBannerText } = await import("@/apps/threads/pages/account-layout");
const { ReconnectButton } = await import("@/apps/threads/components/ReconnectButton");

const TOKEN = "THAAG" + "y".repeat(60);

function makeAccount(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: "a1",
    name: "Cafe B",
    username: "cafe_b",
    displayName: "Cafe B",
    profilePictureUrl: null,
    connectionStatus: "connected",
    lastUsedAt: null,
    role: "owner",
    ownerName: null,
    connectionMethod: "token",
    reconnectHint: null,
    ...overrides,
  };
}

function renderSettings(account: AccountSummary, path = "/threads/accounts/a1/settings") {
  const router = createMemoryRouter(
    [
      {
        path: "/threads/accounts/:accountId",
        element: (
          <UnsavedChangesProvider>
            <Outlet context={{ account }} />
          </UnsavedChangesProvider>
        ),
        children: [{ path: "settings", element: <AccountSettings /> }],
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
  for (const fn of [tokenConnect, connect, accountAccess, toastSuccess, toastError, me]) fn.mockReset();
  accountAccess.mockResolvedValue(OWNER_ACCESS);
  me.mockResolvedValue({ threadsConnectMethods: ["app", "token"] });
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
    expect(dialog).toHaveTextContent("Cafe B（@cafe_b）の接続を更新します。投稿ストックや設定はそのまま残ります。");
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

describe("接続し直しの押す前の案内（specs/025 US1）", () => {
  it("「Threadsで許可する」を出すとき、今つながっている@名前の案内が出る。トークンを選んだ画面には出ない", async () => {
    const user = userEvent.setup();
    renderSettings(makeAccount());
    await user.click(await screen.findByRole("button", { name: "接続し直す" }));
    const dialog = await screen.findByRole("dialog", { name: "Threadsとの接続し直し" });
    expect(within(dialog).getByText(/threads.comでログインしているアカウントで許可されます。/)).toBeInTheDocument();
    expect(within(dialog).getByText("@cafe_b")).toBeInTheDocument();
    // 戻ってきたときはダイアログが閉じているので、手順はダイアログを開くボタンを押すように書く（/code-review 6）
    await user.click(within(dialog).getByRole("button", { name: /違うアカウントが出たときは/ }));
    expect(within(dialog).getByText("・このページに戻って、もう一度「接続し直す」を押す")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /トークンを貼り付ける/ }));
    expect(within(dialog).queryByText(/threads.comでログインしているアカウントで許可されます。/)).not.toBeInTheDocument();
  });

  it("token だけの環境では案内を出さない", async () => {
    me.mockResolvedValue({ threadsConnectMethods: ["token"] });
    const user = userEvent.setup();
    renderSettings(makeAccount());
    await user.click(await screen.findByRole("button", { name: "接続し直す" }));
    const dialog = await screen.findByRole("dialog", { name: "Threadsとの接続し直し" });
    await within(dialog).findByRole("button", { name: /トークンを貼り付ける/ });
    expect(within(dialog).queryByText(/threads.comでログインしているアカウントで許可されます。/)).not.toBeInTheDocument();
  });
});

describe("要再接続のバナー（FR-041）", () => {
  it("オーナー・トークンならトークン用、app なら001の文、パートナー・編集者はオーナーを待つ文", () => {
    expect(reconnectBannerText({ role: "owner", connectionMethod: "token" })).toBe(
      "トークンが使えなくなりました。新しいトークンを貼り付けて接続し直してください。",
    );
    expect(reconnectBannerText({ role: "owner", connectionMethod: "app" })).toMatch(/^Threadsとの接続が切れています。再接続するまで/);
    for (const role of ["editor", "viewer"] as const) {
      expect(reconnectBannerText({ role, connectionMethod: "token" })).toMatch(/オーナーの再接続を待っています/);
    }
  });
});

describe("ReconnectButton（PR #12 のCodexレビュー）", () => {
  function renderButton(account: AccountSummary) {
    const router = createMemoryRouter(
      [
        {
          path: "/threads/accounts/:accountId",
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
      { initialEntries: [`/threads/accounts/${account.id}`] },
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

  it("共通のボタンから接続し直しても、権限がなければダイアログの中で案内する（PR #12 のCodexレビュー）", async () => {
    tokenConnect.mockResolvedValue({ accountId: "a1", kind: "reconnect", username: "cafe_b", warnings: ["no_publish_permission"] });
    const user = userEvent.setup();
    renderButton(makeAccount());
    await user.click(await screen.findByRole("button", { name: "再接続" }));
    const dialog = await screen.findByRole("dialog", { name: "Threadsとの接続し直し" });
    await user.click(within(dialog).getByRole("button", { name: /トークンを貼り付ける/ }));
    await user.type(within(dialog).getByLabelText("アクセストークン"), TOKEN);
    await user.click(within(dialog).getByRole("button", { name: "接続し直す" }));
    expect(await within(dialog).findByText(/このトークンには投稿の権限がありません/)).toBeInTheDocument();
    await user.click(within(dialog).getAllByRole("button", { name: "閉じる" }).at(-1)!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("担当の人・見せてもらっている人には出さない（トークンの入力欄を見せない）", async () => {
    for (const role of ["editor", "viewer"] as const) {
      renderButton(makeAccount({ role }));
      await screen.findByText("描画済み");
      expect(screen.queryByRole("button", { name: "再接続" })).not.toBeInTheDocument();
      cleanup();
    }
  });
});

// つなぐ方法の切り替え（THREADS_CONNECT_METHODS）は、接続し直しのダイアログにも効かせる。
// APIが404で断る方法を、押せる選択肢として見せない（PR #20 のCodexレビュー）
describe("接続し直しで、出していない方法を見せない", () => {
  it("token だけのとき、「Threadsで許可する」を出さない", async () => {
    me.mockResolvedValue({ threadsConnectMethods: ["token"] });
    const user = userEvent.setup();
    renderSettings(makeAccount());
    await user.click(await screen.findByRole("button", { name: "接続し直す" }));
    const dialog = await screen.findByRole("dialog", { name: "Threadsとの接続し直し" });
    await waitFor(() =>
      expect(within(dialog).queryByRole("button", { name: /Threadsで許可する/ })).not.toBeInTheDocument(),
    );
    expect(within(dialog).getByRole("button", { name: /トークンを貼り付ける/ })).toBeInTheDocument();
  });

  it("app だけのとき、「トークンを貼り付ける」を出さない", async () => {
    me.mockResolvedValue({ threadsConnectMethods: ["app"] });
    const user = userEvent.setup();
    renderSettings(makeAccount());
    await user.click(await screen.findByRole("button", { name: "接続し直す" }));
    const dialog = await screen.findByRole("dialog", { name: "Threadsとの接続し直し" });
    await waitFor(() =>
      expect(within(dialog).queryByRole("button", { name: /トークンを貼り付ける/ })).not.toBeInTheDocument(),
    );
    expect(within(dialog).getByRole("button", { name: /Threadsで許可する/ })).toBeInTheDocument();
  });
});

describe("つながっているアカウントで、接続し直しから戻ったときのエラー（specs/025 US2・FR-011・research.md R2）", () => {
  it("違うアカウント（RECONNECT_ACCOUNT_MISMATCH）なら、エラーの文に続けて、今の@名前と「接続し直す」を使った手順を出す", async () => {
    renderSettings(makeAccount(), "/threads/accounts/a1/settings?error=RECONNECT_ACCOUNT_MISMATCH");
    expect(await screen.findByText("再接続には、元の@cafe_bで認可してください。別のアカウントで認可されました。")).toBeInTheDocument();
    expect(screen.getByText("@cafe_b でログインし直す")).toBeInTheDocument();
    expect(screen.getByText("このページに戻って、もう一度「接続し直す」を押す")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /threads.comを開く/ })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("button", { name: "接続し直す" })).toBeInTheDocument();
    // トーストとの二重には出さない（/code-review 1）
    expect(toastError).not.toHaveBeenCalled();
  });

  it("ほかのエラー（キャンセル）は、文だけを出す", async () => {
    renderSettings(makeAccount(), "/threads/accounts/a1/settings?error=THREADS_AUTH_CANCELLED");
    expect(await screen.findByText("Threadsとの接続がキャンセルされました。")).toBeInTheDocument();
    expect(screen.queryByText(/今のアカウントからログアウトする/)).not.toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("要再接続のときは、手順のボタンの名前も「再接続」にする（/code-review 3）", async () => {
    renderSettings(makeAccount({ connectionStatus: "needs_reconnect" }), "/threads/accounts/a1/settings?error=RECONNECT_ACCOUNT_MISMATCH");
    expect(await screen.findByText("このページに戻って、もう一度「再接続」を押す")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "再接続" }).length).toBeGreaterThan(0);
  });

  it("接続し直しを始めたら（ダイアログを開いたら）、戻ってきたエラーを消す（/code-review 2）", async () => {
    const user = userEvent.setup();
    renderSettings(makeAccount(), "/threads/accounts/a1/settings?error=RECONNECT_ACCOUNT_MISMATCH");
    await screen.findByText("@cafe_b でログインし直す");
    await user.click(screen.getByRole("button", { name: "接続し直す" }));
    expect(screen.queryByText("再接続には、元の@cafe_bで認可してください。別のアカウントで認可されました。")).not.toBeInTheDocument();
  });
});
