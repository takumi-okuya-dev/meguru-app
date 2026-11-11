// 設定 > 運営 > アカウント一覧（specs/026-operator-accounts contracts/ui-routes.md、US1〜US3、T004・T009・T013）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OperatorAccount, OperatorAccounts } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "./helpers/billing";

const mocks = vi.hoisted(() => ({ me: vi.fn(), operatorAccounts: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});

const { ApiError } = await import("@/lib/api-client");
const { SettingsLayout } = await import("@/pages/settings/settings-layout");
const { OperatorAccountsPage } = await import("@/pages/settings/operator-accounts");

const ME = {
  user: { id: "u", email: "op@example.com", displayName: null },
  accounts: [],
  landingAccountId: null,
  accountLimit: { max: null, used: 0 },
  threadsAccessMode: "testers" as const,
  threadsConnectMethods: ["app" as const, "token" as const],
  teams: [],
  ...ME_BILLING_OFF,
};

const row = (over: Partial<OperatorAccount> = {}): OperatorAccount => ({
  id: "a1",
  name: "AI部",
  username: "taku.it.ai",
  method: "app",
  status: "connected",
  owner: { name: "山田 太郎", email: "taro@example.com", accountCount: 2 },
  tester: "connected",
  createdAt: "2026-11-09T00:00:00.000Z",
  ...over,
});

const PAGE = (over: Partial<OperatorAccounts> = {}): OperatorAccounts => ({
  counts: { all: 6, app: 3, token: 2, none: 1 },
  items: [
    row(),
    row({ id: "a2", name: "カフェ本店", username: "cafe_b", method: "token", status: "needs_reconnect", tester: null, owner: { name: null, email: "hanako@example.com", accountCount: 1 } }),
    row({ id: "a3", name: "新しいお店", username: null, method: "none", status: "not_connected", tester: "pending", owner: null }),
  ],
  nextCursor: null,
  ...over,
});

function renderAt(path = "/settings/operator-accounts") {
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { path: "appearance", element: <p>外観の中身</p> },
          { path: "operator-accounts", element: <OperatorAccountsPage /> },
        ],
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
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.me.mockResolvedValue({ ...ME, operator: true });
  mocks.operatorAccounts.mockResolvedValue(PAGE());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("「運営」の区分（US1）", () => {
  it("運営者には「アカウント一覧」を「テスター招待」の次に出す", async () => {
    renderAt("/settings/appearance");
    const link = await screen.findByRole("link", { name: "アカウント一覧" });
    expect(link).toHaveAttribute("href", "/settings/operator-accounts");
    const links = screen.getAllByRole("link");
    expect(links.indexOf(link)).toBe(links.indexOf(screen.getByRole("link", { name: "テスター招待" })) + 1);
  });

  it("運営者でなければ出さず、直接開くと「運営者だけ」", async () => {
    mocks.me.mockResolvedValue({ ...ME, operator: false });
    mocks.operatorAccounts.mockRejectedValue(new ApiError("OPERATOR_ONLY", 403));
    renderAt();
    expect(await screen.findByText("この画面は運営者だけが使えます。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "アカウント一覧" })).not.toBeInTheDocument();
  });
});

describe("一覧（US1）", () => {
  it("行に、名前・@ユーザー名・接続方法・状態・オーナーと件数・テスター招待を出す", async () => {
    renderAt();
    const first = (await screen.findByText("AI部")).closest("li")!;
    expect(within(first).getByText("@taku.it.ai")).toBeInTheDocument();
    expect(within(first).getByText("Threadsで許可する")).toBeInTheDocument();
    expect(within(first).getByText("接続中")).toBeInTheDocument();
    expect(within(first).getByText("山田 太郎（2件）")).toBeInTheDocument();
    expect(within(first).getByText("taro@example.com")).toBeInTheDocument();
    expect(within(first).getByText("接続済み")).toBeInTheDocument();

    const token = screen.getByText("カフェ本店").closest("li")!;
    expect(within(token).getByText("トークン")).toBeInTheDocument();
    expect(within(token).getByText("要再接続")).toBeInTheDocument();
    expect(within(token).getByText("名前なし（1件）")).toBeInTheDocument();
    expect(within(token).getAllByText("—")).toHaveLength(1);

    const none = screen.getByText("新しいお店").closest("li")!;
    expect(within(none).getByText("未接続")).toBeInTheDocument();
    expect(within(none).getAllByText("つなぐ前")).toHaveLength(2);
    expect(within(none).getByText("申し込み中")).toBeInTheDocument();
    expect(within(none).getAllByText("—")).toHaveLength(1);
    expect(screen.getByText(/作った日の新しい順/)).toBeInTheDocument();
  });

  it("狭い画面では、1行を段に分ける", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    renderAt();
    const first = (await screen.findByText("AI部")).closest("li")!;
    expect(within(first).getByText("@taku.it.ai・Threadsで許可する")).toBeInTheDocument();
    expect(within(first).getByText("オーナー：山田 太郎（2件）・taro@example.com")).toBeInTheDocument();
    expect(within(first).getByText("テスター招待：接続済み")).toBeInTheDocument();
    const none = screen.getByText("新しいお店").closest("li")!;
    expect(within(none).getByText("未接続・つなぐ前")).toBeInTheDocument();
  });

  it("読めなければエラーの文、行がなければ「ありません」", async () => {
    mocks.operatorAccounts.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500));
    renderAt();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("行がなければ「ありません」", async () => {
    mocks.operatorAccounts.mockResolvedValue(PAGE({ items: [] }));
    renderAt();
    expect(await screen.findByText("ありません")).toBeInTheDocument();
  });

  it("「もっと見る」で次のページを下に足す。失敗したら一覧は残り、エラーの文", async () => {
    mocks.operatorAccounts.mockImplementation(async ({ cursor }: { cursor?: string }) =>
      cursor === "a3" ? PAGE({ items: [row({ id: "a4", name: "4件目のお店" })], nextCursor: null }) : PAGE({ nextCursor: "a3" }),
    );
    renderAt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "もっと見る" }));
    expect(await screen.findByText("4件目のお店")).toBeInTheDocument();
    expect(screen.getByText("AI部")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "もっと見る" })).not.toBeInTheDocument();
  });

  it("続きの読み込みが失敗しても、一覧は残る", async () => {
    mocks.operatorAccounts.mockImplementation(async ({ cursor }: { cursor?: string }) => {
      if (cursor) throw new ApiError("INTERNAL_ERROR", 500);
      return PAGE({ nextCursor: "a3" });
    });
    renderAt();
    await userEvent.setup().click(await screen.findByRole("button", { name: "もっと見る" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("AI部")).toBeInTheDocument();
  });
});

describe("絞り込みと件数（US2）", () => {
  it("タブに件数を出し、初めは「すべて」。「トークン」で method=token を読み直す", async () => {
    renderAt();
    const all = await screen.findByRole("tab", { name: "すべて 6" });
    expect(all).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Threadsで許可する 3" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "つなぐ前 1" })).toBeInTheDocument();
    expect(mocks.operatorAccounts).toHaveBeenLastCalledWith({ method: "all", q: "", cursor: undefined });
    await userEvent.setup().click(screen.getByRole("tab", { name: "トークン 2" }));
    await waitFor(() => expect(mocks.operatorAccounts).toHaveBeenLastCalledWith({ method: "token", q: "", cursor: undefined }));
  });
});

describe("検索（US3）", () => {
  it("入力が止まってから q つきで読み直し、合わなければ「ありません」", async () => {
    renderAt();
    await screen.findByText("AI部");
    mocks.operatorAccounts.mockResolvedValue(PAGE({ items: [] }));
    await userEvent.setup().type(screen.getByRole("searchbox", { name: "アカウント・@ユーザー名・オーナーで探す" }), "zzz");
    await waitFor(() => expect(mocks.operatorAccounts).toHaveBeenLastCalledWith({ method: "all", q: "zzz", cursor: undefined }));
    expect(mocks.operatorAccounts).not.toHaveBeenCalledWith({ method: "all", q: "z", cursor: undefined });
    expect(await screen.findByText("ありません")).toBeInTheDocument();
    // 件数は検索で変わらない
    expect(screen.getByRole("tab", { name: "すべて 6" })).toBeInTheDocument();
  });
});
