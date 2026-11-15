// 接続の完了の画面（セキュリティ監査 run-1 の
// `threads-oauth-callback-state-not-session-bound` の Web 側）。
//
// 以前は無認証の callback が接続まで済ませていた。いまはこの画面がログイン済みの
// POST を出し、行き先はサーバーが決める。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { threadsApi } from "@/apps/threads/lib/api";
import { ThreadsComplete } from "@/apps/threads/pages/threads-complete";

const navigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigate };
});

/**
 * 画面を、クエリ付きで描く。
 * @param search - クエリ文字列（`?` から）
 */
function renderAt(search: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/threads/complete${search}`]}>
        <Routes>
          <Route path="/threads/complete" element={<ThreadsComplete />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigate.mockClear();
  vi.restoreAllMocks();
});

describe("完了の画面のルート", () => {
  it("ログインなしでは開けない（state を作った人かを確かめるのが要なので）", async () => {
    const { routes } = await import("@/router");
    const { isPublicPath } = await import("./helpers/routes");
    expect(isPublicPath(routes, "/threads/complete")).toBe(false);
  });
});

describe("Threads から戻ってきたとき", () => {
  it("state と code をログイン済みのPOSTで送り、サーバーが決めた行き先へ進む", async () => {
    const complete = vi
      .spyOn(threadsApi, "completeConnect")
      .mockResolvedValue({ redirectTo: "/threads/accounts/a1/settings?connected=connect" });
    renderAt("?state=s1&code=c1");
    expect(screen.getByRole("heading", { name: "Threadsにつないでいます" })).toBeInTheDocument();
    await waitFor(() => expect(complete).toHaveBeenCalledWith({ state: "s1", code: "c1" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/threads/accounts/a1/settings?connected=connect", { replace: true }),
    );
  });

  it("履歴に残さない（戻るボタンで、使い終わった state と code のURLに戻らない）", async () => {
    vi.spyOn(threadsApi, "completeConnect").mockResolvedValue({ redirectTo: "/threads/accounts/a1/settings?connected=connect" });
    renderAt("?state=s1&code=c1");
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate.mock.calls[0]?.[1]).toEqual({ replace: true });
  });

  it("完了が断られたら、振り分けへ戻して理由を出す", async () => {
    vi.spyOn(threadsApi, "completeConnect").mockRejectedValue(new Error("nope"));
    renderAt("?state=s1&code=c1");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/threads?error=OAUTH_STATE_INVALID", { replace: true }));
  });

  it("利用者が許可しなかったときは、POSTせずに理由を出す", async () => {
    const complete = vi.spyOn(threadsApi, "completeConnect");
    renderAt("?error=THREADS_AUTH_CANCELLED");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/threads?error=THREADS_AUTH_CANCELLED", { replace: true }));
    expect(complete).not.toHaveBeenCalled();
  });

  it("state か code が無ければ、POSTせずに理由を出す", async () => {
    const complete = vi.spyOn(threadsApi, "completeConnect");
    renderAt("?state=s1");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/threads?error=THREADS_AUTH_FAILED", { replace: true }));
    expect(complete).not.toHaveBeenCalled();
  });

  it("アプリの外へ向かう行き先は使わない", async () => {
    // サーバーは相対パスしか返さないが、万一にも外部へ飛ばさない
    vi.spyOn(threadsApi, "completeConnect").mockResolvedValue({ redirectTo: "//evil.example.com" } as never);
    renderAt("?state=s1&code=c1");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/threads", { replace: true }));
  });

  it("二重に送らない", async () => {
    const complete = vi
      .spyOn(threadsApi, "completeConnect")
      .mockResolvedValue({ redirectTo: "/threads/accounts/a1/settings?connected=connect" });
    renderAt("?state=s1&code=c1");
    await waitFor(() => expect(complete).toHaveBeenCalled());
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
