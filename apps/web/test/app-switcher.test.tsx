// アプリの切り替えと、最後に使ったアプリ（specs/028-meguru-shell contracts/ui-routes.md 3・5・6、research.md R13、T058）。
// 本番にはアプリが1本しかないので、テストの中だけで仮のアプリ（sample）を作って確かめる。外枠のコードは直さず、
// buildRoutes に渡す一覧に足すだけで乗ること（spec SC-005）も、ここで確かめる。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResponse } from "@meguru/shared";
import { AtSignIcon, BoxIcon } from "lucide-react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppModule, AppSidebar } from "@/shell";
import { queryKeys } from "@/lib/query";
import { ME_BILLING_OFF, type MeWithThreads } from "./helpers/billing";

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({ user: null }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

const mocks = vi.hoisted(() => ({ me: vi.fn(), putLastApp: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me: mocks.me, putLastApp: mocks.putLastApp } };
});

const { AppShell, buildRoutes } = await import("@/shell");

/**
 * 仮のアプリを作る。画面は外枠の骨格に、アプリのサイドバーの頭と中身を入れるだけ。
 * @param id - アプリのID
 * @param label - 画面とサイドバーに出す名前
 * @param icon - アイコン
 * @returns アプリの入口
 */
function stubApp(id: string, label: string, icon: AppModule["icon"]): AppModule {
  const sidebar: AppSidebar = {
    Header: () => <p>{label}の頭</p>,
    Body: () => <nav aria-label={`${label}の中身`} className="flex-1" />,
  };
  return {
    id,
    basePath: `/${id}`,
    icon,
    startPath: `/${id}/start`,
    routes: [
      {
        path: `/${id}`,
        element: (
          <AppShell sidebar={sidebar}>
            <h1>{label}のホーム</h1>
          </AppShell>
        ),
      },
    ],
  };
}

const threads = stubApp("threads", "Threads", AtSignIcon);
const sample = stubApp("sample", "サンプル", BoxIcon);

/**
 * /api/me の応答（apps だけを変える）。
 * @param apps - apps
 * @returns 応答
 */
function meWith(apps: MeResponse["apps"]): MeWithThreads {
  return {
    ...ME_BILLING_OFF,
    user: { id: "u1", email: "a@example.com", displayName: null },
    accounts: [],
    landingAccountId: null,
    accountLimit: { max: 3, used: 0 },
    threadsAccessMode: "public",
    threadsConnectMethods: ["app", "token"],
    teams: [],
    apps,
  };
}

/**
 * 仮のアプリを足した一覧で、ルーターを組んで描く。
 * @param path - 開くURL
 * @param client - クエリの置き場（テストの中で読み直すときに渡す）
 * @returns ルーター
 */
function renderAt(path: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const router = createMemoryRouter(buildRoutes([threads, sample]), { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const BOTH = { available: ["threads", "sample"], using: ["threads", "sample"], last: "threads", landing: "threads" };

beforeEach(() => {
  mocks.me.mockReset();
  mocks.putLastApp.mockReset();
  mocks.putLastApp.mockResolvedValue(undefined);
});

describe("アプリの切り替え（contracts/ui-routes.md 5）", () => {
  it("2本とも使っている人には、いちばん上にアプリの切り替えが出て、その下に開いているアプリの頭と中身が出る", async () => {
    mocks.me.mockResolvedValue(meWith(BOTH));
    renderAt("/threads");
    const switcher = await screen.findByRole("button", { name: "アプリを切り替える" });
    expect(switcher).toHaveTextContent("めぐる Threads");
    expect(screen.getByText("Threadsの頭")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Threadsの中身" })).toBeInTheDocument();
  });

  it("1本だけ使っている人には出ない（いちばん上はアプリの頭のまま）", async () => {
    mocks.me.mockResolvedValue(meWith({ available: ["threads", "sample"], using: ["threads"], last: "threads", landing: "threads" }));
    renderAt("/threads");
    expect(await screen.findByText("Threadsの頭")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "アプリを切り替える" })).toBeNull();
  });

  it("開いているアプリを使い始めていなければ出さない（切り替えの一覧に、開いているアプリがないため）", async () => {
    mocks.me.mockResolvedValue(meWith({ available: ["threads", "sample", "other"], using: ["sample", "other"], last: "sample", landing: "sample" }));
    renderAt("/threads");
    expect(await screen.findByText("Threadsの頭")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "アプリを切り替える" })).toBeNull();
  });

  it("押すと使っているアプリと「すべてのアプリ」が出て、選んだアプリのホームへ移る", async () => {
    const user = userEvent.setup();
    mocks.me.mockResolvedValue(meWith(BOTH));
    const router = renderAt("/threads");
    await user.click(await screen.findByRole("button", { name: "アプリを切り替える" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /めぐる Threads/ })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("menuitem", { name: "すべてのアプリ" })).toHaveAttribute("href", "/apps");
    await user.click(within(menu).getByRole("menuitem", { name: /sample/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sample"));
    expect(await screen.findByRole("heading", { name: "サンプルのホーム" })).toBeInTheDocument();
  });
});

describe("最後に使ったアプリ（contracts/ui-routes.md 3・6）", () => {
  it("入口の行き先が仮のアプリなら、入口（/）で仮のアプリが開く", async () => {
    mocks.me.mockResolvedValue(meWith({ ...BOTH, last: "sample", landing: "sample" }));
    const router = renderAt("/");
    expect(await screen.findByRole("heading", { name: "サンプルのホーム" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/sample");
  });

  it("アプリの画面を開くと、最後に使ったアプリでなければ PUT /api/me/last-app を1回だけ呼ぶ", async () => {
    mocks.me.mockResolvedValue(meWith(BOTH));
    renderAt("/sample");
    await screen.findByRole("heading", { name: "サンプルのホーム" });
    await waitFor(() => expect(mocks.putLastApp).toHaveBeenCalledWith("sample"));
    expect(mocks.putLastApp).toHaveBeenCalledTimes(1);
  });

  it("最後に使ったアプリと同じなら呼ばない", async () => {
    mocks.me.mockResolvedValue(meWith(BOTH));
    renderAt("/threads");
    await screen.findByRole("heading", { name: "Threadsのホーム" });
    await waitFor(() => expect(mocks.me).toHaveBeenCalled());
    expect(mocks.putLastApp).not.toHaveBeenCalled();
  });

  it("すべてのアプリの画面では呼ばない", async () => {
    mocks.me.mockResolvedValue(meWith(BOTH));
    renderAt("/apps");
    expect(await screen.findByRole("heading", { name: "すべてのアプリ" })).toBeInTheDocument();
    expect(mocks.putLastApp).not.toHaveBeenCalled();
  });

  it("覚えるのに失敗しても、画面にエラーを出さない", async () => {
    mocks.me.mockResolvedValue(meWith(BOTH));
    mocks.putLastApp.mockRejectedValue(new Error("network"));
    renderAt("/sample");
    expect(await screen.findByRole("heading", { name: "サンプルのホーム" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.putLastApp).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    // 失敗しても、同じアプリのまま送り続けない
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.putLastApp).toHaveBeenCalledTimes(1);
  });

  it("送っている間に別のアプリへ移り、前の送信が失敗しても、移った先のアプリを覚える", async () => {
    mocks.me.mockResolvedValue(meWith({ ...BOTH, last: null }));
    let rejectSample: (e: Error) => void = () => {};
    mocks.putLastApp.mockImplementation((id: string) =>
      id === "sample" ? new Promise<void>((_, reject) => (rejectSample = reject)) : Promise.resolve(),
    );
    const router = renderAt("/sample");
    await waitFor(() => expect(mocks.putLastApp).toHaveBeenCalledWith("sample"));
    await router.navigate("/threads");
    await screen.findByRole("heading", { name: "Threadsのホーム" });
    expect(mocks.putLastApp).not.toHaveBeenCalledWith("threads");
    rejectSample(new Error("network"));
    await waitFor(() => expect(mocks.putLastApp).toHaveBeenCalledWith("threads"));
    expect(mocks.putLastApp).toHaveBeenCalledTimes(2);
  });

  it("覚えたあと、別のタブで別のアプリが最後になり、読み直して戻ったら、もう一度覚え直す", async () => {
    mocks.me.mockResolvedValue(meWith({ ...BOTH, last: "sample", landing: "sample" }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderAt("/threads", client);
    await waitFor(() => expect(mocks.putLastApp).toHaveBeenCalledWith("threads"));
    await waitFor(() => expect(client.getQueryData<MeWithThreads>(queryKeys.me)?.apps.last).toBe("threads"));
    // 別のタブでサンプルを開いた：読み直すと apps.last がサンプルに戻る
    await client.refetchQueries({ queryKey: queryKeys.me });
    await waitFor(() => expect(mocks.putLastApp).toHaveBeenCalledTimes(2));
    expect(mocks.putLastApp).toHaveBeenLastCalledWith("threads");
  });
});
