// 「Threadsとの接続」の未接続のときの2つの方法（specs/012 US2・US3、contracts/ui-routes.md「Threadsとの接続」）。
// トークンの方法は specs/010 の追加の画面から移した（入力欄の隠し方・待ち・mutation cache の確認は010のまま）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, MeResponse } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "./helpers/billing";

let meResponse: MeResponse;
const mocks = vi.hoisted(() => ({ tokenConnect: vi.fn(), connect: vi.fn(), assign: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { ...actual.api, me: () => Promise.resolve(meResponse), connect: mocks.connect, tokenConnect: mocks.tokenConnect },
  };
});

const { ConnectMethods } = await import("@/components/connect/ConnectMethods");
const { ApiError } = await import("@/lib/api-client");

const TOKEN = "THAAG" + "x".repeat(60);

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
const other: AccountSummary = { ...unconnected, id: "a9", name: "カフェ本店", username: "cafe_b", connectionStatus: "connected", connectionMethod: "app" };

let client: QueryClient;
const onConnected = vi.fn();

function renderIt(
  opts: {
    canConnect?: boolean;
    initialError?: { code: "ACCOUNT_ALREADY_REGISTERED" | "THREADS_AUTH_CANCELLED"; account: string | null };
    /** 出すつなぐ方法（既定は両方） */
    methods?: ("app" | "token")[];
  } = {},
) {
  meResponse = {
    user: { id: "u", email: "u@example.com", displayName: null },
    accounts: [unconnected, other],
    landingAccountId: "a1",
    accountLimit: { max: 5, used: 2 },
    ...ME_BILLING_OFF,
    threadsAccessMode: "testers",
    threadsConnectMethods: opts.methods ?? ["app", "token"],
    teams: [],
  };
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:id/settings",
        element: (
          <ConnectMethods
            account={unconnected}
            canConnect={opts.canConnect ?? true}
            initialError={opts.initialError ?? null}
            onConnected={onConnected}
          />
        ),
      },
    ],
    { initialEntries: ["/accounts/a1/settings"] },
  );
  render(
    <QueryClientProvider client={(client = new QueryClient({ defaultOptions: { queries: { retry: false } } }))}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function openToken() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /自分のMetaアプリのトークンでつなぐ/ }));
  return user;
}

beforeEach(() => {
  mocks.tokenConnect.mockReset();
  mocks.connect.mockReset();
  onConnected.mockReset();
});

describe("未接続の「Threadsとの接続」（US2）", () => {
  it("「未接続」・説明・「Threadsで許可する」・検証期間の案内。トークンの方法は開くまで欄を出さない（US2-1）", async () => {
    renderIt();
    expect(await screen.findByText("未接続")).toBeInTheDocument();
    expect(screen.getByText(/Threadsにつなぐと、承認した案を自動で投稿し、反応を分析できます/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Threadsで許可する" })).toBeEnabled();
    expect(await screen.findByText(/現在は検証期間中のため/)).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /自分のMetaアプリのトークンでつなぐ/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("アクセストークン")).not.toBeInTheDocument();
  });

  it("「Threadsで許可する」は connect（対象はこのアカウント）で許可の画面を求める", async () => {
    // 許可の画面への移動（location.assign）は jsdom では確かめられないので、要求の中身だけを見る
    mocks.connect.mockReturnValue(new Promise(() => {}));
    renderIt();
    await userEvent.click(await screen.findByRole("button", { name: "Threadsで許可する" }));
    expect(mocks.connect).toHaveBeenCalledWith({ mode: "connect", accountId: "a1" });
    expect(screen.getByRole("button", { name: "Threadsで許可する" })).toBeDisabled();
  });

  it("オーナーでなければ、つなぐ操作もトークンの欄も出さない（FR-015）", async () => {
    renderIt({ canConnect: false });
    expect(await screen.findByText("オーナーがThreadsにつなぐと使えます")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Threadsで許可する" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /トークンでつなぐ/ })).not.toBeInTheDocument();
  });

  it("許可の画面から戻ってきたエラーは、区分の中に出す", async () => {
    renderIt({ initialError: { code: "THREADS_AUTH_CANCELLED", account: null } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/キャンセル|取り消/);
  });
});

describe("トークンでつなぐ（specs/010 から移した）", () => {
  it("開くと、手順5つ・詳しい手順・入力欄（パスワード欄ではなく、文字を隠す）・説明・利用規約・つなぐが出る", async () => {
    renderIt();
    await openToken();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "詳しい手順を見る" })).toHaveAttribute("href", "/guide/threads-token");
    const input = screen.getByLabelText("アクセストークン");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("data-1p-ignore");
    expect(screen.getByText(/トークンは暗号化して保存し、画面に二度と表示しません/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "利用規約" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("button", { name: "つなぐ" })).toBeInTheDocument();
  });

  it("隠している間は欄に「•」だけを出し、「表示」で本当の値が見える。1文字でも消すと全部を消す", async () => {
    renderIt();
    const user = await openToken();
    const input = screen.getByLabelText("アクセストークン");
    await user.click(input);
    await user.paste(TOKEN);
    expect(input).toHaveValue("•".repeat(TOKEN.length));
    await user.click(screen.getByRole("button", { name: "表示" }));
    expect(input).toHaveValue(TOKEN);
    await user.click(screen.getByRole("button", { name: "隠す" }));
    await user.click(input);
    await user.keyboard("{Backspace}");
    expect(input).toHaveValue("");
  });

  it("形の違う文字列では送らない", async () => {
    renderIt();
    const user = await openToken();
    await user.type(screen.getByLabelText("アクセストークン"), "これはトークンではない");
    await user.click(screen.getByRole("button", { name: "つなぐ" }));
    expect(await screen.findByText("トークンの形ではないようです")).toBeInTheDocument();
    expect(mocks.tokenConnect).not.toHaveBeenCalled();
  });

  it("成功すると connect で送り、権限の案内を親に渡す（US2-3）", async () => {
    mocks.tokenConnect.mockResolvedValue({ accountId: "a1", kind: "connect", username: "cafe_b", warnings: ["no_publish_permission"] });
    renderIt();
    const user = await openToken();
    await user.type(screen.getByLabelText("アクセストークン"), TOKEN);
    await user.click(screen.getByRole("button", { name: "つなぐ" }));
    await vi.waitFor(() => expect(onConnected).toHaveBeenCalledWith(["no_publish_permission"]));
    expect(mocks.tokenConnect).toHaveBeenCalledWith({ mode: "connect", accountId: "a1", token: TOKEN });
  });

  it("待ちのときは残りの分を出し、ボタンを無効にする（010 FR-015）", async () => {
    mocks.tokenConnect.mockRejectedValue(new ApiError("TOKEN_CHECK_LOCKED", 429, ["420"]));
    renderIt();
    const user = await openToken();
    await user.type(screen.getByLabelText("アクセストークン"), TOKEN);
    await user.click(screen.getByRole("button", { name: "つなぐ" }));
    expect(await screen.findByText("しばらく待ってから、もう一度お試しください（あと7分）。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "つなぐ" })).toBeDisabled();
  });

  it("送ったトークンを mutation cache に残さない（010 PR #12 のCodexレビュー）", async () => {
    mocks.tokenConnect.mockRejectedValueOnce(new ApiError("TOKEN_INVALID", 400));
    renderIt();
    const user = await openToken();
    await user.type(screen.getByLabelText("アクセストークン"), TOKEN);
    await user.click(screen.getByRole("button", { name: "つなぐ" }));
    expect(await screen.findByText(/トークンを確かめられませんでした/)).toBeInTheDocument();
    const cached = JSON.stringify(client.getMutationCache().getAll().map((m) => m.state));
    expect(cached).not.toContain(TOKEN);
  });
});

describe("自分の別のアカウントと重なったとき（US3-1）", () => {
  it("トークン：重なったアカウントの名前と、そのアカウントの設定へのリンクを出す", async () => {
    mocks.tokenConnect.mockRejectedValue(new ApiError("ACCOUNT_ALREADY_REGISTERED", 409, ["a9", "カフェ本店", "cafe_b"]));
    renderIt();
    const user = await openToken();
    await user.type(screen.getByLabelText("アクセストークン"), TOKEN);
    await user.click(screen.getByRole("button", { name: "つなぐ" }));
    expect(await screen.findByText("@cafe_bは、あなたのアカウント『カフェ本店』につながっています。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "『カフェ本店』を開く" })).toHaveAttribute("href", "/accounts/a9/settings");
  });

  it("このアプリの接続から戻ってきたとき（?error=…&account=…）も、名前とリンクを出す", async () => {
    renderIt({ initialError: { code: "ACCOUNT_ALREADY_REGISTERED", account: "a9" } });
    expect(await screen.findByText("@cafe_bは、あなたのアカウント『カフェ本店』につながっています。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "『カフェ本店』を開く" })).toHaveAttribute("href", "/accounts/a9/settings");    // 取り違えから戻ったときの切り替えの手順も、リンクを残したまま出す（specs/025 US2・FR-006）
    expect(screen.getByText("つなぎたいアカウントでログインし直す")).toBeInTheDocument();
    expect(screen.getByText("このページに戻って、もう一度「Threadsで許可する」を押す")).toBeInTheDocument();
  });
});

// つなぐ方法の切り替え（THREADS_CONNECT_METHODS）。App Review を通すまで、または
// 通らなかったときに、トークンの方法だけで運用できるようにする。既定は両方
describe("出す方法を環境の設定で絞る", () => {
  it("token だけのとき、「Threadsで許可する」を出さず、トークンの手順を最初から開く", async () => {
    renderIt({ methods: ["token"] });
    // トークンの入力欄が最初から出ている（唯一の方法なので畳まない）
    expect(await screen.findByLabelText("アクセストークン")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Threadsで許可する" })).not.toBeInTheDocument();
    // 畳むためのボタンも出さない
    expect(screen.queryByRole("button", { name: /自分のMetaアプリのトークンでつなぐ/ })).not.toBeInTheDocument();
  });

  it("app だけのとき、トークンの方法を出さない", async () => {
    renderIt({ methods: ["app"] });
    expect(await screen.findByRole("button", { name: "Threadsで許可する" })).toBeInTheDocument();
    // me の取得が終わるまでは既定（両方）なので、消えるのを待つ
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /自分のMetaアプリのトークンでつなぐ/ })).not.toBeInTheDocument(),
    );
  });

  it("既定（両方）のときは、これまでどおり", async () => {
    renderIt();
    expect(await screen.findByRole("button", { name: "Threadsで許可する" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /自分のMetaアプリのトークンでつなぐ/ })).toBeInTheDocument();
    // トークンの欄は、開くまで出さない
    expect(screen.queryByLabelText("アクセストークン")).not.toBeInTheDocument();
  });
});
