// URLの移動と転送（specs/028-meguru-shell contracts/ui-routes.md 1〜3、T029・T030・T031）。
// 前のURL（/accounts/…・/teams/…）は /threads の下へ移り、入口（/）はThreadsのホームへ移る。公開ページのURLは変えない。
import { render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppModule } from "@/shell";
import { isPublicPath } from "./helpers/routes";

let auth = { isLoaded: true, isSignedIn: true };
const listeners = new Set<() => void>();
vi.mock("@clerk/react", () => ({
  useAuth: () =>
    useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => auth,
    ),
}));

const { threadsApp } = await import("@/apps/threads");
const { buildRoutes } = await import("@/shell");

/** 今いる場所を出す。 */
function Where() {
  const { pathname, search, hash } = useLocation();
  return <p data-testid="where">{`${pathname}${search}${hash}`}</p>;
}

/** Threadsの転送の設定だけを持ち、画面は場所を出すだけの仮のThreads（画面のAPIを呼ばずに、ルートと転送だけを確かめる）。 */
const stubThreads: AppModule = {
  id: "threads",
  basePath: "/threads",
  routes: [
    { path: "/threads", element: <Where /> },
    { path: "/threads/accounts/*", element: <Where /> },
    { path: "/threads/teams/*", element: <Where /> },
  ],
  legacyRedirects: threadsApp.legacyRedirects,
};

/**
 * ルーターを組んで描く。
 * @param entries - 履歴（最後が今の場所）
 * @param apps - アプリの入口
 * @returns ルーター
 */
function renderAt(entries: string[], apps: AppModule[] = [stubThreads]) {
  const router = createMemoryRouter(
    [{ path: "/sign-in/*", element: <p>ログイン画面</p> }, ...buildRoutes(apps)],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("前のURLの転送（contracts/ui-routes.md 2）", () => {
  beforeEach(() => {
    auth = { isLoaded: true, isSignedIn: true };
  });

  it.each([
    ["/accounts/12/external-media?view=work#x", "/threads/accounts/12/external-media?view=work#x"],
    ["/accounts/new", "/threads/accounts/new"],
    ["/accounts/12", "/threads/accounts/12"],
    ["/teams/3/assign", "/threads/teams/3/assign"],
    ["/teams/3/accounts/12", "/threads/teams/3/accounts/12"],
    ["/accounts", "/threads/accounts"],
    ["/Accounts/12/stock", "/threads/accounts/12/stock"],
  ])("%s は %s へ移る（パスの残り・クエリ・#を保つ）", async (from, to) => {
    renderAt([from]);
    expect(await screen.findByTestId("where")).toHaveTextContent(to);
  });

  it("履歴を置き換える（戻るボタンで前のURLに戻らない）", async () => {
    const router = renderAt(["/start", "/accounts/12/stock"]);
    await screen.findByTestId("where");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(router.state.location.pathname).toBe("/threads/accounts/12/stock");
  });

  it("転送はログインの関所の外にある。ログインしていなくても、新しいURLへ移ってからログインへ進む", async () => {
    expect(isPublicPath(buildRoutes([threadsApp]), "/accounts/*")).toBe(true);
    expect(isPublicPath(buildRoutes([threadsApp]), "/teams/*")).toBe(true);
    auth = { isLoaded: true, isSignedIn: false };
    const router = renderAt(["/accounts/12/stock"]);
    expect(await screen.findByText("ログイン画面")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/sign-in");
  });
});

describe("入口とThreadsのホーム（contracts/ui-routes.md 3）", () => {
  beforeEach(() => {
    auth = { isLoaded: true, isSignedIn: true };
  });

  it("入口（/）は、クエリを保ってThreadsのホーム（/threads）へ移る", async () => {
    const router = renderAt(["/?error=OAUTH_STATE_INVALID"]);
    expect(await screen.findByTestId("where")).toHaveTextContent("/threads?error=OAUTH_STATE_INVALID");
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("/threads の下の知らないURLは「見つかりません」", async () => {
    renderAt(["/threads/nothing"], [threadsApp]);
    expect(await screen.findByRole("heading", { name: "ページが見つかりません" })).toBeInTheDocument();
  });

  it("出せるアプリがなければ、入口は「見つかりません」", async () => {
    renderAt(["/"], []);
    expect(await screen.findByRole("heading", { name: "ページが見つかりません" })).toBeInTheDocument();
  });
});

describe("URLを変えないページ（contracts/ui-routes.md 1-1、T031）", () => {
  it.each(["/sign-in/*", "/terms", "/legal/commerce", "/guide/threads-token", "/invite/:token", "/test-invite/:token", "/r/:code", "/data-deletion/:code"])(
    "%s は、URLを変えずにログインなしで開ける",
    (path) => {
      expect(isPublicPath(buildRoutes([threadsApp]), path)).toBe(true);
    },
  );

  it.each(["/threads/complete", "/settings"])("%s は、URLを変えずにログインの関所の中にある", (path) => {
    expect(isPublicPath(buildRoutes([threadsApp]), path)).toBe(false);
  });
});
