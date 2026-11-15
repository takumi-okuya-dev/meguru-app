// 設定の誤りの案内（Web）：Clerk のキー、Clerk の読み込みの時間切れ、API の失敗
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResponse } from "@meguru/shared";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUsablePublishableKey } from "@/lib/config-check";

const auth = { isLoaded: false, isSignedIn: false };
vi.mock("@clerk/react", () => ({ useAuth: () => auth, SignIn: () => null }));

let meImpl: () => Promise<MeResponse>;
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me: () => meImpl() } };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, me: () => meImpl() } };
});

const { ApiError } = await import("@/lib/api-client");
const { threadsApi } = await import("@/apps/threads/lib/api");
const { Landing } = await import("@/apps/threads/pages/home");
const { RequireAuth } = await import("@/shell/guards/RequireAuth");

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Clerk のキーの確認", () => {
  it.each([undefined, "", "pk_test_xxx", "sk_test_abc", "pk_test_short"])("%j は使えないキー", (key) => {
    expect(isUsablePublishableKey(key)).toBe(false);
  });
  it("Clerk の形のキーは使える", () => {
    expect(isUsablePublishableKey("pk_test_dGVzdC5jbGVyay5hY2NvdW50cy5kZXYk")).toBe(true);
  });
});

describe("Clerk の読み込みが終わらないとき", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("一定時間が過ぎたら、読み込み中のまま止めずに案内を出す", async () => {
    auth.isLoaded = false;
    renderWithQuery(<RequireAuth />);
    expect(screen.getByTestId("loading")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByRole("heading", { name: "ログインの仕組みを読み込めませんでした" })).toBeInTheDocument();
  });
});

describe("API の呼び出しに失敗したとき", () => {
  it("設定の誤りなら、項目名を含む案内と再読み込みのボタンを出す", async () => {
    meImpl = () => Promise.reject(new ApiError("CONFIG_ERROR", 500, ["IDENTIFIER_HASH_KEY"]));
    renderWithQuery(<Landing />);
    expect(await screen.findByRole("heading", { name: "サーバーの設定に誤りがあります" })).toBeInTheDocument();
    expect(screen.getByText(/IDENTIFIER_HASH_KEY/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeInTheDocument();
  });

  // 公開された環境では API が項目名を返さない（セキュリティ監査 run-1）。
  // そのとき、開発者向けの .dev.vars の案内まで利用者に見せない
  it("項目名が無ければ、.dev.vars の案内を出さない", async () => {
    meImpl = () => Promise.reject(new ApiError("CONFIG_ERROR", 500));
    renderWithQuery(<Landing />);
    expect(await screen.findByRole("heading", { name: "サーバーの設定に誤りがあります" })).toBeInTheDocument();
    expect(screen.queryByText(/\.dev\.vars/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeInTheDocument();
  });

  it("APIに接続できなければ、接続先のURLを含む案内を出し、再読み込みで呼び直す", async () => {
    let calls = 0;
    meImpl = () => {
      calls += 1;
      return Promise.reject(new ApiError("API_UNREACHABLE", 0));
    };
    renderWithQuery(<Landing />);
    expect(await screen.findByRole("heading", { name: "APIに接続できません" })).toBeInTheDocument();
    expect(screen.getByText(/localhost:8787/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    await vi.waitFor(() => expect(calls).toBe(2));
  });
});

describe("APIクライアント", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("通信に失敗したら API_UNREACHABLE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(threadsApi.account("a1")).rejects.toMatchObject({ code: "API_UNREACHABLE", status: 0 });
  });

  it("CONFIG_ERROR の項目名を受け取る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "CONFIG_ERROR", message: "x", details: ["WEB_ORIGIN"] } }), {
          status: 500,
        }),
      ),
    );
    await expect(threadsApi.account("a1")).rejects.toMatchObject({ code: "CONFIG_ERROR", details: ["WEB_ORIGIN"] });
  });
});
