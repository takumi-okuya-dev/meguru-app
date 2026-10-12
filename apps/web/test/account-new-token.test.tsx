// 追加の画面の「自分のMetaアプリのトークンで追加する」（specs/010-token-account-add contracts/ui-routes.md、US1・US2）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResponse } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

let meResponse: MeResponse;
const tokenConnect = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me: () => Promise.resolve(meResponse), connect: vi.fn(), tokenConnect } };
});
vi.mock("@clerk/react", () => ({ useUser: () => ({ user: null }), useClerk: () => ({ signOut: vi.fn() }) }));

const { AccountNew } = await import("@/pages/account-new");
const { ApiError } = await import("@/lib/api-client");

const TOKEN = "THAAG" + "x".repeat(60);

let client: QueryClient;

function renderPage(used = 0, max = 1) {
  meResponse = {
    user: { id: "u", email: "u@example.com", displayName: null },
    accounts: [],
    landingAccountId: null,
    accountLimit: { max, used },
    threadsAccessMode: "testers",
    partnerTeam: null,
    editorWaiting: null,
  };
  const router = createMemoryRouter(
    [
      { path: "/accounts/new", element: <AccountNew /> },
      { path: "/accounts/:id", element: <p>ホームに移りました</p> },
      { path: "/accounts/:id/settings", element: <p>設定に移りました</p> },
    ],
    { initialEntries: ["/accounts/new"] },
  );
  render(
    <QueryClientProvider client={(client = new QueryClient({ defaultOptions: { queries: { retry: false } } }))}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function open() {
  const user = userEvent.setup();
  const toggle = await screen.findByRole("button", { name: /自分のMetaアプリのトークンで追加する/ });
  await user.click(toggle);
  return user;
}

beforeEach(() => {
  tokenConnect.mockReset();
});

describe("トークンで追加する（US1）", () => {
  it("初めは閉じていて、入力欄は出ない。主のボタンと検証期間の案内は今のまま（SC-007）", async () => {
    renderPage();
    const toggle = await screen.findByRole("button", { name: /自分のMetaアプリのトークンで追加する/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("アクセストークン")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Threadsアカウントを接続" })).toBeEnabled();
    expect(screen.getByText(/現在は検証期間中のため/)).toBeInTheDocument();
  });

  it("開くと、手順5つ・詳しい手順・入力欄（パスワード欄ではなく、文字を隠す）・説明・利用規約・追加するが出る", async () => {
    renderPage();
    await open();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "詳しい手順を見る" })).toHaveAttribute("href", "/guide/threads-token");
    const input = screen.getByLabelText("アクセストークン");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("data-1p-ignore");
    expect(input.className).toContain("token-masked");
    expect(screen.getByText(/トークンは暗号化して保存し、画面に二度と表示しません/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "利用規約" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("button", { name: "追加する" })).toBeInTheDocument();
  });

  it("「表示」で文字を隠すのを外せる", async () => {
    renderPage();
    const user = await open();
    await user.click(screen.getByRole("button", { name: "表示" }));
    expect(screen.getByLabelText("アクセストークン").className).not.toContain("token-masked");
  });

  it("形の違う文字列では送らない", async () => {
    renderPage();
    const user = await open();
    await user.type(screen.getByLabelText("アクセストークン"), "これはトークンではない");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(await screen.findByText("トークンの形ではないようです")).toBeInTheDocument();
    expect(tokenConnect).not.toHaveBeenCalled();
  });

  it("成功すると、そのAccountのホームへ移る（権限がなければ warn を付ける）", async () => {
    tokenConnect.mockResolvedValue({ accountId: "a1", kind: "new", username: "cafe_b", warnings: ["no_publish_permission"] });
    const router = renderPage();
    const user = await open();
    await user.type(screen.getByLabelText("アクセストークン"), TOKEN);
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(await screen.findByText("ホームに移りました")).toBeInTheDocument();
    expect(tokenConnect).toHaveBeenCalledWith({ mode: "new", token: TOKEN });
    expect(router.state.location.search).toBe("?connected=new&warn=publish");
  });

  it("待ちのときは残りの分を出し、ボタンを無効にする（FR-015）", async () => {
    tokenConnect.mockRejectedValue(new ApiError("TOKEN_CHECK_LOCKED", 429, ["420"]));
    renderPage();
    const user = await open();
    await user.type(screen.getByLabelText("アクセストークン"), TOKEN);
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(await screen.findByText("しばらく待ってから、もう一度お試しください（あと7分）。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "追加する" })).toBeDisabled();
  });

  it("すでに登録されていれば、そのアカウントの設定へのリンクを出す（US2-1）", async () => {
    tokenConnect.mockRejectedValue(new ApiError("ACCOUNT_ALREADY_REGISTERED", 409, ["a9"]));
    renderPage();
    const user = await open();
    await user.type(screen.getByLabelText("アクセストークン"), TOKEN);
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(await screen.findByText(/このアカウントはすでに登録されています/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "そのアカウントの設定を開く" })).toHaveAttribute("href", "/accounts/a9/settings");
  });

  it("上限に達していれば、開いても入力欄の代わりに上限の案内", async () => {
    renderPage(1, 1);
    await open();
    expect(screen.queryByLabelText("アクセストークン")).not.toBeInTheDocument();
    expect(screen.getAllByText(/プラン3にすると最大5件まで登録できます/).length).toBeGreaterThan(0);
  });

  it("送ったトークンを mutation cache に残さない（成功・失敗とも。PR #12 のCodexレビュー）", async () => {
    tokenConnect.mockRejectedValueOnce(new ApiError("TOKEN_INVALID", 400));
    renderPage();
    const user = await open();
    await user.type(screen.getByLabelText("アクセストークン"), TOKEN);
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(await screen.findByText(/トークンを確かめられませんでした/)).toBeInTheDocument();
    const cached = JSON.stringify(client.getMutationCache().getAll().map((m) => m.state));
    expect(cached).not.toContain(TOKEN);
    expect(tokenConnect).toHaveBeenCalledWith({ mode: "new", token: TOKEN });
  });
});
