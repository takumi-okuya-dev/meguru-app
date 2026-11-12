// US2：「このアカウントの設定」の「Threadsとの接続」（specs/012 FR-010〜FR-014、contracts/ui-routes.md「このアカウントの設定」）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary } from "@meguru/shared";
import { createMemoryRouter, Outlet, RouterProvider, useParams } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ACCESS } from "./helpers/access";
import { ME_BILLING_OFF, type MeWithThreads } from "./helpers/billing";

const mocks = vi.hoisted(() => ({ me: vi.fn(), tokenConnect: vi.fn(), getPostingSchedule: vi.fn(), renameAccount: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { ...actual.api, me: mocks.me },
  };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return {
    ...actual,
    threadsApi: {
      ...actual.threadsApi,
      tokenConnect: mocks.tokenConnect,
      renameAccount: mocks.renameAccount,
      accountAccess: vi.fn(async () => OWNER_ACCESS),
      getPostingRules: vi.fn(() => new Promise(() => {})),
      getPostingSchedule: mocks.getPostingSchedule,
      getAutoPost: vi.fn(() => new Promise(() => {})),
      accountTeam: vi.fn(() => new Promise(() => {})),
    },
  };
});
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() } }));

const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { AccountSettings } = await import("@/apps/threads/pages/account-settings");

const TOKEN = "THAAG" + "x".repeat(60);
const INVITE = `/invite/t_${"b".repeat(43)}`;

const unconnected: AccountSummary = {
  id: "a1",
  name: "カフェの公式",
  username: null,
  displayName: null,
  profilePictureUrl: null,
  connectionStatus: "not_connected",
  connectionMethod: null,
  lastUsedAt: null,
  role: "owner",
  ownerName: null,
};
const connected: AccountSummary = { ...unconnected, username: "cafe_b", displayName: "Cafe B", connectionStatus: "connected", connectionMethod: "app" };

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
      { path: "/invite/:token", element: <p>招待の画面</p> },
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
  sessionStorage.clear();
  toastSuccess.mockReset();
  mocks.tokenConnect.mockReset();
  mocks.renameAccount.mockReset();
  const me: MeWithThreads = {
    user: { id: "u", email: "u@example.com", displayName: null },
    accounts: [unconnected],
    landingAccountId: "a1",
    accountLimit: { max: 1, used: 1 },
    ...ME_BILLING_OFF,
    threadsAccessMode: "public",
    threadsConnectMethods: ["app", "token"] as const,
    teams: [],
  };
  mocks.me.mockResolvedValue(me);
  mocks.getPostingSchedule.mockResolvedValue({
    schedule: { enabled: false, slotTimes: [], jitter: true, version: 0 },
    limits: { slots: 10, minGapMinutes: 30, jitterMinutes: 10 },
  });
});

describe("このアカウントの設定の「Threadsとの接続」", () => {
  it("未接続なら、2つの方法を出す。接続し直す・再接続は出さない（FR-010・FR-036）", async () => {
    renderSettings(unconnected);
    expect(await screen.findByRole("button", { name: "Threadsで許可する" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /自分のMetaアプリのトークンでつなぐ/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /接続し直す|再接続/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/今の接続/)).not.toBeInTheDocument();
  });

  it("許可の画面からつながって戻る（?connected=connect）と、「つながりました」と「自動投稿を始める」。トーストは出さない（US2-2）", async () => {
    renderSettings(connected, "/threads/accounts/a1/settings?connected=connect");
    expect(await screen.findByText("カフェの公式をThreadsにつなぎました（@cafe_b）")).toBeInTheDocument();
    expect(screen.getByText(/自動投稿はオフのままです/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "自動投稿を始める" })).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("「自動投稿を始める」で、投稿のスケジュールの設定を開く（FR-014）", async () => {
    renderSettings(connected, "/threads/accounts/a1/settings?connected=connect");
    await userEvent.click(await screen.findByRole("button", { name: "自動投稿を始める" }));
    expect(await screen.findByRole("dialog", { name: "投稿のスケジュール" })).toBeInTheDocument();
  });

  it("接続し直して戻ったとき（?connected=reconnect）は、今までどおりトースト", async () => {
    renderSettings(connected, "/threads/accounts/a1/settings?connected=reconnect");
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("カフェの公式を再接続しました"));
    expect(screen.queryByText(/をThreadsにつなぎました/)).not.toBeInTheDocument();
  });

  it("トークンでつなぐと、同じ画面で「つながりました」を出す（US2-3）", async () => {
    mocks.tokenConnect.mockResolvedValue({ accountId: "a1", kind: "connect", username: "cafe_b", warnings: [] });
    renderSettings(unconnected);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /自分のMetaアプリのトークンでつなぐ/ }));
    await user.type(screen.getByLabelText("アクセストークン"), TOKEN);
    await user.click(screen.getByRole("button", { name: "つなぐ" }));
    // アカウントの表示が読み直されるまでは未接続の表示のまま。つないだ直後の合図は立っている
    await vi.waitFor(() => expect(mocks.tokenConnect).toHaveBeenCalled());
  });

  it("招待のリンクから来た人は、つないだら招待の画面へ戻る（specs/011 T019、specs/012 research.md R7）", async () => {
    sessionStorage.setItem("tg.inviteReturn", INVITE);
    const router = renderSettings(connected, "/threads/accounts/a1/settings?connected=connect");
    expect(await screen.findByText("招待の画面")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(INVITE);
  });
});

describe("未接続の投稿のスケジュール（specs/012 FR-032）", () => {
  it("区分に「Threadsにつなぐと使えます」。設定のダイアログでは自動投稿のスイッチを使えず、理由を示す。「接続を確かめる」は出さない", async () => {
    renderSettings(unconnected);
    const section = (await screen.findByRole("heading", { name: "投稿のスケジュール" })).closest("section")!;
    expect(await within(section).findByText("Threadsにつなぐと使えます")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "接続を確かめる" })).not.toBeInTheDocument();
    await userEvent.click(await within(section).findByRole("button", { name: "編集" }));
    const dialog = await screen.findByRole("dialog", { name: "投稿のスケジュール" });
    const sw = within(dialog).getByRole("switch", { name: "自動投稿" });
    expect(sw).toBeDisabled();
    expect(sw).toHaveAccessibleDescription("Threadsにつなぐと使えます。時刻は先に決めておけます");
  });
});

describe("アカウントの名前（specs/012 FR-040・FR-043、US5-3・US5-4）", () => {
  it("オーナーは一番上の区分で名前を直せる。保存すると前後の空白を除いて送る", async () => {
    mocks.renameAccount.mockResolvedValue({ ...connected, name: "カフェ本店" });
    renderSettings(connected);
    const input = await screen.findByRole("textbox", { name: "名前" });
    expect(input).toHaveValue("カフェの公式");
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, " カフェ本店 ");
    await user.click(screen.getByRole("button", { name: "名前を保存" }));
    await vi.waitFor(() => expect(mocks.renameAccount).toHaveBeenCalledWith("a1", { name: "カフェ本店" }));
    expect(toastSuccess).toHaveBeenCalledWith("名前を保存しました");
  });

  it("空・空白だけ・変えていないときは保存できない", async () => {
    renderSettings(connected);
    const input = await screen.findByRole("textbox", { name: "名前" });
    const save = screen.getByRole("button", { name: "名前を保存" });
    expect(save).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "   ");
    expect(save).toBeDisabled();
  });

  it("削除の確認は、アカウントの名前を入れる。未接続ならトークンの注意を出さない", async () => {
    renderSettings({ ...unconnected, connectionMethod: null });
    await userEvent.click(await screen.findByRole("button", { name: "Accountを削除" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("確認のため、カフェの公式 と入力してください。");
    expect(dialog).not.toHaveTextContent("Metaアプリ側のトークン");
    const remove = within(dialog).getByRole("button", { name: "削除する" });
    await userEvent.type(within(dialog).getByLabelText("確認のためのアカウントの名前"), "カフェ");
    expect(remove).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("確認のためのアカウントの名前"), "の公式");
    expect(remove).toBeEnabled();
  });
});

describe("アカウントが変わったら、削除の確認を消す（PR #15 のCodexレビュー）", () => {
  function AccountOutlet() {
    const { accountId } = useParams();
    // 名前の重なった2つのアカウント（名前は止めない。spec Edge Cases）
    const account = accountId === "a1" ? connected : { ...connected, id: "a2", username: "cafe_c" };
    return <Outlet context={{ account }} />;
  }

  it("同じ名前の別のアカウントの設定へ移ると、削除のダイアログが閉じ、入力も消える", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/threads/accounts/:accountId",
          element: (
            <UnsavedChangesProvider>
              <AccountOutlet />
            </UnsavedChangesProvider>
          ),
          children: [{ path: "settings", element: <AccountSettings /> }],
        },
      ],
      { initialEntries: ["/threads/accounts/a1/settings"] },
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Accountを削除" }));
    await userEvent.type(await screen.findByLabelText("確認のためのアカウントの名前"), "カフェの公式");
    expect(screen.getByRole("button", { name: "削除する" })).toBeEnabled();

    await act(() => router.navigate("/threads/accounts/a2/settings"));
    expect(screen.queryByRole("button", { name: "削除する" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Accountを削除" }));
    expect(await screen.findByLabelText("確認のためのアカウントの名前")).toHaveValue("");
    expect(screen.getByRole("button", { name: "削除する" })).toBeDisabled();
  });
});

describe("#threads で開くと「Threadsとの接続」まで動かす（PR #15 のCodexレビュー）", () => {
  it("区分までスクロールし、見出しにフォーカスを移す。ハッシュがなければ動かさない", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderSettings(unconnected, "/threads/accounts/a1/settings#threads");
    await vi.waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.instances[0]).toBe(document.getElementById("threads"));
    expect(await screen.findByRole("heading", { name: "Threadsとの接続" })).toHaveFocus();
  });

  it("ハッシュがなければ動かさない", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderSettings(unconnected);
    await screen.findByRole("heading", { name: "Threadsとの接続" });
    expect(scroll).not.toHaveBeenCalled();
  });
});
