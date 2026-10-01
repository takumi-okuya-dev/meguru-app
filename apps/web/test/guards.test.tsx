// US2：未ログインのガード（FR-003・FR-006、SC-003）
import { act, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 本物の Clerk と同じく、セッションの状態が変わったら再描画されるようにする
let auth = { isLoaded: true, isSignedIn: false };
const listeners = new Set<() => void>();
function setAuth(next: Partial<typeof auth>) {
  auth = { ...auth, ...next };
  listeners.forEach((l) => l());
}
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

const { RequireAuth } = await import("@/components/guards");

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/sign-in", element: <p>ログイン画面</p> },
      { element: <RequireAuth />, children: [{ path: "/accounts/:id", element: <p>保護された内容</p> }] },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("RequireAuth", () => {
  beforeEach(() => {
    auth = { isLoaded: true, isSignedIn: false };
  });

  it("未ログインなら内容を描画せずに /sign-in へ置き換え遷移する", async () => {
    const router = renderAt("/accounts/a1");
    expect(await screen.findByText("ログイン画面")).toBeInTheDocument();
    expect(screen.queryByText("保護された内容")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/sign-in");
    // 置き換え遷移なので、履歴に保護された画面は残らない
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("読み込み中は骨組みだけで、内容は出さない", () => {
    auth = { isLoaded: false, isSignedIn: false };
    renderAt("/accounts/a1");
    expect(screen.getByTestId("loading")).toBeInTheDocument();
    expect(screen.queryByText("保護された内容")).not.toBeInTheDocument();
  });

  it("ログイン済みなら内容を表示する", async () => {
    auth = { isLoaded: true, isSignedIn: true };
    renderAt("/accounts/a1");
    expect(await screen.findByText("保護された内容")).toBeInTheDocument();
  });

  it("ログアウトした後に「戻る」で保護された画面へ戻っても、内容は表示されない", async () => {
    auth = { isLoaded: true, isSignedIn: true };
    const router = renderAt("/accounts/a1");
    expect(await screen.findByText("保護された内容")).toBeInTheDocument();
    // ログアウト：セッションが終わると、表示中の保護された画面も /sign-in へ置き換わる
    act(() => setAuth({ isSignedIn: false }));
    expect(await screen.findByText("ログイン画面")).toBeInTheDocument();
    // ブラウザの「戻る」で保護された画面のURLへ戻っても、内容は出ない
    await act(() => router.navigate("/accounts/a1"));
    expect(await screen.findByText("ログイン画面")).toBeInTheDocument();
    expect(screen.queryByText("保護された内容")).not.toBeInTheDocument();
  });
});
