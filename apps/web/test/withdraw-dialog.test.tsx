// 退会（specs/013-billing contracts/ui-routes.md「退会」、T051・T052）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ThreadsWithdrawalPreview, WithdrawalPreview } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn(async () => {});
vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut }),
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({ user: { fullName: "たくみ", primaryEmailAddress: { emailAddress: "t@example.com" } } }),
}));
const withdrawalPreview = vi.fn();
const threadsWithdrawalPreview = vi.fn();
const withdraw = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, withdrawalPreview, withdraw } };
});
// 消えるアカウントとチームの行き先は、Threadsが AppModule の withdrawalPreview で渡す（specs/meguru/029 T052）
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, withdrawalPreview: threadsWithdrawalPreview } };
});

const { ApiError, setWithdrawalInProgress } = await import("@/lib/api-client");
const { AccountSettingsPage } = await import("@/shell/settings/account");
const { RequireAuth } = await import("@/shell/guards/RequireAuth");
const { AppRegistryProvider } = await import("@/shell/app-module");
const { threadsApp } = await import("@/apps/threads");

const PREVIEW: WithdrawalPreview & ThreadsWithdrawalPreview = {
  email: "t@example.com",
  ownedAccounts: [
    { id: "a1", name: "カフェの公式" },
    { id: "a2", name: "店長" },
  ],
  teams: [
    { id: "t1", name: "AI部", isAdmin: true, outcome: "transfer", nextAdminName: "田中" },
    { id: "t2", name: "交流会", isAdmin: true, outcome: "delete", nextAdminName: null },
    { id: "t3", name: "手伝い", isAdmin: false, outcome: "leave", nextAdminName: null },
  ],
  hasActiveSubscription: true,
};

function renderSettings() {
  const router = createMemoryRouter(
    [
      { path: "/settings/account", element: <AccountSettingsPage /> },
      { path: "/sign-in", element: <p>ログインの画面</p> },
    ],
    { initialEntries: ["/settings/account"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppRegistryProvider value={[threadsApp]}>
        <RouterProvider router={router} />
      </AppRegistryProvider>
    </QueryClientProvider>,
  );
  return router;
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "退会する" }));
  return screen.findByRole("dialog", { name: "退会しますか？" });
}

beforeEach(() => {
  withdrawalPreview.mockReset().mockResolvedValue(PREVIEW);
  // Threadsの分（/api/threads/me/withdrawal-preview）は、消えるアカウントとチームの行き先だけ
  threadsWithdrawalPreview.mockReset().mockResolvedValue({ ownedAccounts: PREVIEW.ownedAccounts, teams: PREVIEW.teams });
  withdraw.mockReset();
  signOut.mockClear();
  setWithdrawalInProgress(false);
});

describe("退会のダイアログ", () => {
  it("消えるもの・チームの行き先・契約の扱いを出し、メールアドレスが合うまで押せない（大文字・空白は区別しない）", async () => {
    renderSettings();
    await openDialog();
    expect(await screen.findByText("あなたのアカウント（2件）：カフェの公式、店長")).toBeInTheDocument();
    expect(screen.getByText("AI部：田中さんに管理者を引き継ぎます")).toBeInTheDocument();
    expect(screen.getByText("交流会：チームを削除します")).toBeInTheDocument();
    expect(screen.getByText("手伝い：チームから外れます")).toBeInTheDocument();
    expect(screen.getByText("契約はすぐに止まり、残りの期間の返金はありません。")).toBeInTheDocument();
    const confirm = () => screen.getAllByRole("button", { name: "退会する" }).at(-1)!;
    expect(confirm()).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/確認のため、メールアドレス/), "other@example.com");
    expect(confirm()).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/確認のため、メールアドレス/));
    await userEvent.type(screen.getByLabelText(/確認のため、メールアドレス/), " T@Example.com ");
    expect(confirm()).toBeEnabled();
  });

  it("成功したらログアウトして、入口に「退会しました」を出す画面へ移る", async () => {
    withdraw.mockResolvedValue(undefined);
    const router = renderSettings();
    await openDialog();
    await userEvent.type(await screen.findByLabelText(/確認のため、メールアドレス/), "t@example.com");
    await userEvent.click(screen.getAllByRole("button", { name: "退会する" }).at(-1)!);
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(withdraw).toHaveBeenCalledWith("t@example.com");
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(router.state.location.search).toBe("?withdrawn=1");
  });

  it("Stripeにつながらなければダイアログの中に文言を出し、もう一度押せる", async () => {
    withdraw.mockRejectedValue(new ApiError("BILLING_UNAVAILABLE", 503));
    renderSettings();
    await openDialog();
    await userEvent.type(await screen.findByLabelText(/確認のため、メールアドレス/), "t@example.com");
    await userEvent.click(screen.getAllByRole("button", { name: "退会する" }).at(-1)!);
    expect(await screen.findByText(/支払いの手続きにつながりませんでした/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "退会する" }).at(-1)!).toBeEnabled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("メールアドレスが違うと言われたら、入力欄の下に出す", async () => {
    withdraw.mockRejectedValue(new ApiError("CONFIRMATION_MISMATCH", 422));
    renderSettings();
    await openDialog();
    await userEvent.type(await screen.findByLabelText(/確認のため、メールアドレス/), "t@example.com");
    await userEvent.click(screen.getAllByRole("button", { name: "退会する" }).at(-1)!);
    expect(await screen.findByText("メールアドレスが違います")).toBeInTheDocument();
  });
});

describe("退会の途中（T052）", () => {
  it("WITHDRAWAL_IN_PROGRESS を受けたら、ログインの後の画面は「退会の手続きの途中です」だけになる", async () => {
    const router = createMemoryRouter([{ element: <RequireAuth />, children: [{ path: "/", element: <p>ホーム</p> }] }], {
      initialEntries: ["/"],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppRegistryProvider value={[threadsApp]}>
          <RouterProvider router={router} />
        </AppRegistryProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("ホーム")).toBeInTheDocument();
    act(() => setWithdrawalInProgress(true));
    expect(await screen.findByRole("heading", { name: "退会の手続きの途中です" })).toBeInTheDocument();
    expect(screen.queryByText("ホーム")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退会する" })).toBeInTheDocument();
    // 退会の途中でも、ダイアログはThreadsの分を読んで出し、確かめの欄まで出る（PR #104 のセルフレビュー）
    await userEvent.click(screen.getByRole("button", { name: "退会する" }));
    expect(await screen.findByText("あなたのアカウント（2件）：カフェの公式、店長")).toBeInTheDocument();
    expect(screen.getByLabelText(/確認のため、メールアドレス/)).toBeInTheDocument();
  });

  it("メールアドレスを入れたあと開き直して、アプリの分が読めなければ「退会する」は押せない", async () => {
    renderSettings();
    await openDialog();
    await screen.findByText("あなたのアカウント（2件）：カフェの公式、店長");
    await userEvent.type(screen.getByLabelText(/確認のため、メールアドレス/), "t@example.com");
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    threadsWithdrawalPreview.mockReset().mockRejectedValue(new ApiError("INTERNAL_ERROR", 500));
    await openDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("退会の内容を読み込めませんでした");
    expect(screen.getAllByRole("button", { name: "退会する" }).at(-1)).toBeDisabled();
  });

  it("アプリの分が読めなければ、消えるものを見せずに退会させない（読み込めなかったと出す）", async () => {
    threadsWithdrawalPreview.mockReset().mockRejectedValue(new ApiError("INTERNAL_ERROR", 500));
    renderSettings();
    await openDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("退会の内容を読み込めませんでした");
    expect(screen.queryByLabelText(/確認のため、メールアドレス/)).not.toBeInTheDocument();
  });
});
