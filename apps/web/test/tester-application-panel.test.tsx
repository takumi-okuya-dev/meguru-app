// つなぐ画面の招待の申し込み（specs/024-tester-invite-connect contracts/ui-routes.md 2、FR-004〜FR-007、T013・T014・T060）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, ErrorCode, MeResponse, TesterApplicationResponse } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "./helpers/billing";

let meResponse: MeResponse;
let appResponse: TesterApplicationResponse;
const mocks = vi.hoisted(() => ({ apply: vi.fn(), cancel: vi.fn(), connect: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: () => Promise.resolve(meResponse),
      testerApplication: () => Promise.resolve(appResponse),
      applyTester: mocks.apply,
      cancelTesterApplication: mocks.cancel,
      connect: mocks.connect,
    },
  };
});

const { ConnectMethods } = await import("@/components/connect/ConnectMethods");
const { ApiError } = await import("@/lib/api-client");

const account: AccountSummary = {
  id: "a1",
  name: "お店のアカウント",
  username: null,
  displayName: null,
  profilePictureUrl: null,
  connectionStatus: "not_connected",
  connectionMethod: null,
  lastUsedAt: null,
  role: "owner",
  ownerName: null,
};

const app = (status: "pending" | "invited" | "declined", over: Partial<NonNullable<TesterApplicationResponse["application"]>> = {}) => ({
  id: "ap1",
  threadsUsername: "shop_tokyo",
  status,
  declineReason: null,
  createdAt: "2026-11-08T00:00:00.000Z",
  statusChangedAt: "2026-11-08T00:00:00.000Z",
  ...over,
});

function renderIt(opts: { enabled?: boolean; initialError?: { code: ErrorCode; account: string | null } } = {}) {
  meResponse = {
    user: { id: "u", email: "u@example.com", displayName: null },
    accounts: [account],
    landingAccountId: "a1",
    accountLimit: { max: 3, used: 1 },
    ...ME_BILLING_OFF,
    testerInvites: { enabled: opts.enabled ?? true },
    threadsAccessMode: "testers",
    threadsConnectMethods: ["app", "token"],
    teams: [],
  };
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:id/settings",
        element: <ConnectMethods account={account} canConnect initialError={opts.initialError ?? null} onConnected={vi.fn()} />,
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
  appResponse = { enabled: true, application: null };
  mocks.apply.mockReset();
  mocks.cancel.mockReset();
  mocks.connect.mockReset();
});

describe("申し込み前", () => {
  it("ユーザー名の欄・説明・「招待を申し込む」。「Threadsで許可する」は出さず、トークンの方法は閉じて残る", async () => {
    renderIt();
    expect(await screen.findByLabelText("Threadsのユーザー名")).toBeInTheDocument();
    expect(screen.getByText("運営者がテスターに招待したあと、つなげます。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "招待を申し込む" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Threadsで許可する" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /自分のMetaアプリのトークンでつなぐ/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("申し込むと、書いたユーザー名で申し込みを送る", async () => {
    mocks.apply.mockImplementation(async () => {
      appResponse = { enabled: true, application: app("pending") };
      return app("pending");
    });
    renderIt();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Threadsのユーザー名"), "@Shop_Tokyo");
    await user.click(screen.getByRole("button", { name: "招待を申し込む" }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith("a1", "@Shop_Tokyo"));
    expect(await screen.findByText("運営者の招待をお待ちください。")).toBeInTheDocument();
  });

  it("形の違うユーザー名は送らずに注意を出す。RATE_LIMITED の文", async () => {
    renderIt();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Threadsのユーザー名"), "shop tokyo");
    await user.click(screen.getByRole("button", { name: "招待を申し込む" }));
    expect(await screen.findByText("Threadsのユーザー名を確かめてください")).toBeInTheDocument();
    expect(mocks.apply).not.toHaveBeenCalled();

    mocks.apply.mockRejectedValue(new ApiError("RATE_LIMITED", 429));
    await user.clear(screen.getByLabelText("Threadsのユーザー名"));
    await user.type(screen.getByLabelText("Threadsのユーザー名"), "shop");
    await user.click(screen.getByRole("button", { name: "招待を申し込む" }));
    expect(await screen.findByText("少し時間をおいてから、もう一度お試しください。")).toBeInTheDocument();
  });
});

describe("申し込み中・招待済み・見送り", () => {
  it("申し込み中：ユーザー名と待っていること、取り消し", async () => {
    appResponse = { enabled: true, application: app("pending") };
    mocks.cancel.mockImplementation(async () => {
      appResponse = { enabled: true, application: null };
    });
    renderIt();
    expect(await screen.findByText("@shop_tokyo")).toBeInTheDocument();
    expect(screen.getByText("申し込み中")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "申し込みを取り消す" }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("a1"));
    expect(await screen.findByRole("button", { name: "招待を申し込む" })).toBeInTheDocument();
  });

  it("招待済み：承認の手順3つ・「Threadsで許可する」・小さな注意・取り消し", async () => {
    appResponse = { enabled: true, application: app("invited") };
    renderIt();
    expect(await screen.findByText("招待済み")).toBeInTheDocument();
    expect(screen.getByText(/設定 › アカウント › ウェブサイトのアクセス許可 › 招待/)).toBeInTheDocument();
    expect(screen.getByText("招待を承認する")).toBeInTheDocument();
    expect(screen.getByText("下の「Threadsで許可する」を押す")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Threadsで許可する" })).toBeEnabled();
    expect(screen.getByText("つなげなかったときは、招待を承認してから、もう一度お試しください。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "申し込みを取り消す" })).toBeInTheDocument();
  });

  it("見送り：理由と、前の値を入れた欄で申し込み直せる", async () => {
    appResponse = { enabled: true, application: app("declined", { declineReason: "今は枠がありません" }) };
    renderIt();
    expect(await screen.findByText("今回は招待を見送りました")).toBeInTheDocument();
    expect(screen.getByText("今は枠がありません")).toBeInTheDocument();
    expect(screen.getByLabelText("Threadsのユーザー名")).toHaveValue("shop_tokyo");
    expect(screen.getByRole("button", { name: "もう一度申し込む" })).toBeInTheDocument();
  });
});

describe("押す前の案内（specs/025 US1）", () => {
  it("招待済みでは、申し込んだ@名前の案内が出る", async () => {
    appResponse = { enabled: true, application: app("invited") };
    renderIt();
    await screen.findByText("招待済み");
    expect(screen.getByText(/threads.comでログインしているアカウントで許可されます。/)).toBeInTheDocument();
    expect(screen.getByText("@shop_tokyo", { selector: "strong" })).toBeInTheDocument();
  });

  it("招待の管理がOFFのつなぐ画面では、名前のない案内が出る", async () => {
    renderIt({ enabled: false });
    expect(await screen.findByText("threads.comでログインしているアカウントで許可されます。")).toBeInTheDocument();
  });

  it("申し込み前・申し込み中には出さない（「Threadsで許可する」がないため）", async () => {
    renderIt();
    await screen.findByLabelText("Threadsのユーザー名");
    expect(screen.queryByText(/threads.comでログインしているアカウントで許可されます。/)).not.toBeInTheDocument();
  });
});

describe("招待済みでつなげなかったとき（FR-007）", () => {
  it.each(["THREADS_AUTH_CANCELLED", "THREADS_AUTH_FAILED"] as const)("%s で戻ったら、承認してからの案内を出す", async (code) => {
    appResponse = { enabled: true, application: app("invited") };
    renderIt({ initialError: { code, account: null } });
    expect(await screen.findByText("招待を承認してから、もう一度お試しください。")).toBeInTheDocument();
    expect(screen.queryByText("Threadsとの接続がキャンセルされました。")).not.toBeInTheDocument();
  });

  it("招待済みでも、ほかのエラー（別の人が登録済みなど）はそのまま出す", async () => {
    appResponse = { enabled: true, application: app("invited") };
    renderIt({ initialError: { code: "THREADS_ACCOUNT_TAKEN", account: null } });
    expect(await screen.findByText("このThreadsアカウントは別のユーザーが登録済みです。")).toBeInTheDocument();
    expect(screen.queryByText("招待を承認してから、もう一度お試しください。")).not.toBeInTheDocument();
  });

  it("招待済みで取り違えのエラーなら、申し込んだ@名前で切り替えの手順を出す（specs/025 US2）", async () => {
    appResponse = { enabled: true, application: app("invited") };
    renderIt({ initialError: { code: "THREADS_ACCOUNT_TAKEN", account: null } });
    await screen.findByText("招待済み");
    expect(await screen.findByText("@shop_tokyo でログインし直す")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /threads.comを開く/ }).length).toBeGreaterThan(0);
  });

  it("招待の管理がOFFで取り違えのエラーなら、「つなぎたいアカウント」で手順を出す。キャンセルでは出さない", async () => {
    renderIt({ enabled: false, initialError: { code: "THREADS_ACCOUNT_TAKEN", account: null } });
    expect(await screen.findByText("つなぎたいアカウントでログインし直す")).toBeInTheDocument();
    cleanup();
    renderIt({ enabled: false, initialError: { code: "THREADS_AUTH_CANCELLED", account: null } });
    expect(await screen.findByText("Threadsとの接続がキャンセルされました。")).toBeInTheDocument();
    expect(screen.queryByText("つなぎたいアカウントでログインし直す")).not.toBeInTheDocument();
  });

  it("招待済みでなければ、今のエラーのまま", async () => {
    appResponse = { enabled: true, application: app("pending") };
    renderIt({ initialError: { code: "THREADS_AUTH_CANCELLED", account: null } });
    expect(await screen.findByText("Threadsとの接続がキャンセルされました。")).toBeInTheDocument();
  });
});

describe("招待の管理がOFF（US5）", () => {
  it("申し込みの欄を出さず、今の「Threadsで許可する」のまま", async () => {
    renderIt({ enabled: false });
    expect(await screen.findByRole("button", { name: "Threadsで許可する" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Threadsのユーザー名")).not.toBeInTheDocument();
  });
});
