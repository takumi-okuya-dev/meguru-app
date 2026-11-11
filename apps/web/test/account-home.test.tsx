// US4：Accountのホーム（specs/002 FR-017・FR-024b、contracts/ui-routes.md「ホーム」、research.md R11）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, ProfileStatus, AutoPostStatus } from "@meguru/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { OWNER_ACCESS } from "./helpers/access";

let current: ProfileStatus | Error;
let approved = 0;
let referral: () => Promise<{ url: string; referredCount: number }> = async () => ({ url: "https://app.example/r/r_abcdefghijklmnopqrstuv", referredCount: 2 });
let auto: AutoPostStatus = { autoPost: { enabled: false, slotCount: 0, stoppedReason: null }, next: null, approvedCount: 0, daysLeft: null, notices: [] };
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getAutoPost: async () => auto,
      getDraftCounts: async () => ({ needsReview: 0, approved, rejected: 0, published: 0, publishFailed: 0 }),
      accountAccess: async () => OWNER_ACCESS,
      // 「はじめに読んでほしいこと」は利用者が分かってから出す（specs/014 FR-061）。ここでは出さない
      me: () => new Promise(() => {}),
      referral: () => referral(),
      getProfileStatus: () => (current instanceof Error ? Promise.reject(current) : Promise.resolve(current)),
    },
  };
});

const { AccountHome } = await import("@/apps/threads/pages/account-home");

const account: AccountSummary = {
  id: "a1",
  name: "たくみ",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  connectionStatus: "connected",
  lastUsedAt: null,
  role: "owner" as const,
  ownerName: null,
};

function status(overrides: Partial<ProfileStatus> = {}): ProfileStatus {
  return {
    strategy: { filledCount: 0, totalCount: 16 },
    promotions: { targetableCount: 0, totalCount: 0 },
    research: { referencePostCount: 0, keywordCount: 0 },
    access: { canEdit: true, inTrial: true, trialEndsAt: "2026-11-03T03:00:00.000Z", trialDaysLeft: 12 },
    ...overrides,
  };
}

function renderHome(s: ProfileStatus | Error, acc: AccountSummary = account) {
  current = s;
  const router = createMemoryRouter(
    [{ path: "/accounts/:accountId", element: <Outlet context={{ account: acc }} />, children: [{ index: true, element: <AccountHome /> }] }],
    { initialEntries: ["/accounts/a1"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("Accountのホーム", () => {
  it("何も入力していなければ「まずは「課題」から埋めましょう」と3枚のカードが出る", async () => {
    renderHome(status());
    expect(await screen.findByRole("heading", { name: "まずは「課題」から埋めましょう" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /課題.*0\/16 入力済み/ })).toHaveAttribute("href", "/accounts/a1/strategy");
    expect(screen.getByRole("link", { name: /宣伝内容.*宣伝の対象 0件/ })).toHaveAttribute("href", "/accounts/a1/promotions");
    expect(screen.getByRole("link", { name: /リサーチ.*参考投稿 0件/ })).toHaveAttribute("href", "/accounts/a1/research");
  });

  it("課題だけ入力済みなら「次は「宣伝内容」を登録しましょう」", async () => {
    renderHome(status({ strategy: { filledCount: 8, totalCount: 16 } }));
    expect(await screen.findByRole("heading", { name: "次は「宣伝内容」を登録しましょう" })).toBeInTheDocument();
  });

  it("宣伝内容もあれば「次は「リサーチ」がおすすめです」", async () => {
    renderHome(status({ strategy: { filledCount: 8, totalCount: 16 }, promotions: { targetableCount: 0, totalCount: 1 } }));
    expect(await screen.findByRole("heading", { name: "次は「リサーチ」がおすすめです" })).toBeInTheDocument();
  });

  it("全部あれば「投稿をつくりましょう」と、「投稿をつくる」の画面へのボタン（specs/003、specs/014 FR-164）", async () => {
    renderHome(
      status({
        strategy: { filledCount: 16, totalCount: 16 },
        promotions: { targetableCount: 1, totalCount: 1 },
        research: { referencePostCount: 3, keywordCount: 0 },
      }),
    );
    expect(await screen.findByRole("heading", { name: "投稿をつくりましょう" })).toBeInTheDocument();
    expect(
      screen.getByText("プロンプトをChatGPTやClaudeに送り、返ってきた投稿案を投稿ストックに登録します。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "投稿をつくる" })).toHaveAttribute("href", "/accounts/a1/create");
  });

  it("無料体験中は「無料体験中：{YYYY年M月D日}まで、すべての機能を使えます」が出る（FR-024b）", async () => {
    renderHome(status());
    // 残りの日数を添える（specs/013 FR-046、T022）
    expect(await screen.findByText("無料体験中：2026年11月3日まで（あと12日）、すべての機能を使えます")).toBeInTheDocument();
  });

  it("canEdit: false では、読むだけの案内に変わる（specs/013）", async () => {
    renderHome(status({ access: { canEdit: false, inTrial: false, trialEndsAt: "2026-09-01T00:00:00.000Z", trialDaysLeft: null } }));
    expect(await screen.findByRole("heading", { name: "このアカウントは今、読むだけです" })).toBeInTheDocument();
    expect(screen.queryByText(/無料体験中/)).not.toBeInTheDocument();
  });

  it("入力状況を読み込めなければ、読み込み中のまま止めずに原因と「再読み込み」を出す（Codexレビュー P2）", async () => {
    const { ApiError } = await import("@/lib/api-client");
    renderHome(new ApiError("INTERNAL_ERROR", 500));
    expect(await screen.findByRole("heading", { name: "読み込めませんでした" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeInTheDocument();
  });
});


describe("005：次の投稿", () => {
  it("オフでは設定を案内する", async () => {
    renderHome(status());
    expect(await screen.findByText("自動投稿はオフです")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "投稿のスケジュールを設定する" })).toHaveAttribute("href", "/accounts/a1/settings");
  });
  it("予定と書き出し・残りの日数を出す", async () => {
    auto = { autoPost: { enabled: true, slotCount: 3, stoppedReason: null }, next: { at: "2026-10-08T03:00:00Z", draft: { id: "d", excerpt: "次の本文" } }, approvedCount: 5, daysLeft: 1, notices: [] };
    renderHome(status());
    expect(await screen.findByText("次の本文")).toBeInTheDocument();
    expect(screen.getByText("承認済み 5件・あと1日分")).toBeInTheDocument();
  });
  it("承認済み0件では次の投稿を準備する案内を出す", async () => {
    auto = { ...auto, next: null, approvedCount: 0, daysLeft: 0 };
    renderHome(status());
    expect(await screen.findByText("承認済みの下書きがありません")).toBeInTheDocument();
  });
  it("停止中では予定を出さず、停止理由を出す", async () => {
    auto = { ...auto, autoPost: { enabled: true, slotCount: 3, stoppedReason: "needs_reconnect" } };
    renderHome(status());
    expect(await screen.findByRole("button", { name: "再接続" })).toBeInTheDocument();
    expect(screen.getByText(/接続が切れているため/)).toBeInTheDocument();
  });
});

describe("未接続のアカウントのホーム（specs/012 US4、Clarifications 2026-10-14）", () => {
  const unconnected: AccountSummary = {
    ...account,
    name: "カフェの公式",
    username: null,
    displayName: null,
    connectionStatus: "not_connected",
    connectionMethod: null,
  };

  it("一番上に控えめな帯「未接続」と「Threadsにつなぐ」。名前と「未接続」が出て、@null は出ない（FR-034、SC-006）", async () => {
    auto = { autoPost: { enabled: false, slotCount: 0, stoppedReason: null }, next: null, approvedCount: 0, daysLeft: null, notices: [{ kind: "not_connected" }] };
    approved = 0;
    renderHome(status(), unconnected);
    const banner = await screen.findByRole("region", { name: "Threadsとの接続" });
    expect(banner).toHaveTextContent("未接続：Threadsにつなぐと、承認した案を自動で投稿し、反応を分析できます");
    expect(await screen.findByRole("link", { name: "Threadsにつなぐ" })).toHaveAttribute("href", "/accounts/a1/settings#threads");
    expect(screen.getByRole("heading", { name: "カフェの公式" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/@null|@undefined/);
    // 承認済みが0件なら、次にやることは今までどおり
    expect(await screen.findByRole("heading", { name: "まずは「課題」から埋めましょう" })).toBeInTheDocument();
  });

  it("承認済みの案が1件以上なら、次にやることが「Threadsにつないで自動投稿を始めましょう」になる", async () => {
    approved = 2;
    renderHome(status(), unconnected);
    expect(await screen.findByRole("heading", { name: "Threadsにつないで自動投稿を始めましょう" })).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Threadsにつなぐ" });
    expect(links.every((l) => l.getAttribute("href") === "/accounts/a1/settings#threads")).toBe(true);
  });

  it("つないだアカウントには帯も「つなぐ」も出さない", async () => {
    approved = 2;
    auto = { ...auto, notices: [] };
    renderHome(status());
    await screen.findByRole("heading", { name: "まずは「課題」から埋めましょう" });
    expect(screen.queryByRole("region", { name: "Threadsとの接続" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Threadsにつなぐ" })).not.toBeInTheDocument();
  });
});

describe("017：アプリを紹介する", () => {
  it("紹介リンクをコピーでき、紹介した人数は設定 › 紹介 へ案内する", async () => {
    const user = userEvent.setup();
    renderHome(status());
    const card = await screen.findByRole("region", { name: "アプリを紹介する" });
    await user.click(within(card).getByRole("button", { name: "リンクをコピー" }));
    await expect(navigator.clipboard.readText()).resolves.toBe("https://app.example/r/r_abcdefghijklmnopqrstuv");
    expect(within(card).getByRole("button", { name: "コピーしました" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "紹介した人数を見る" })).toHaveAttribute("href", "/settings/referral");
    // 人数はホームには出さない
    expect(within(card).queryByText(/2人/)).not.toBeInTheDocument();
  });

  it("共有できる端末では「共有する」で紹介リンクを渡す", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      const user = userEvent.setup();
      renderHome(status());
      const card = await screen.findByRole("region", { name: "アプリを紹介する" });
      await user.click(within(card).getByRole("button", { name: "共有する" }));
      expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: "https://app.example/r/r_abcdefghijklmnopqrstuv" }));
    } finally {
      // @ts-expect-error テストで足したものを消す
      delete navigator.share;
    }
  });

  it("共有できない端末では「共有する」を出さない", async () => {
    renderHome(status());
    const card = await screen.findByRole("region", { name: "アプリを紹介する" });
    expect(within(card).queryByRole("button", { name: "共有する" })).not.toBeInTheDocument();
  });

  it("コピーできなければ、リンクを選んだ状態で出す", async () => {
    const user = userEvent.setup();
    renderHome(status());
    const card = await screen.findByRole("region", { name: "アプリを紹介する" });
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    await user.click(within(card).getByRole("button", { name: "リンクをコピー" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("コピーできませんでした");
    const input = within(card).getByRole("textbox", { name: "紹介リンク" });
    expect(input).toHaveValue("https://app.example/r/r_abcdefghijklmnopqrstuv");
    await vi.waitFor(() => expect(input).toHaveFocus());
  });

  it("紹介リンクを読めなければ、カードを出さずにホームの残りは出す", async () => {
    const { ApiError } = await import("@/lib/api-client");
    referral = () => Promise.reject(new ApiError("INTERNAL_ERROR", 500));
    try {
      renderHome(status());
      expect(await screen.findByRole("heading", { name: "まずは「課題」から埋めましょう" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "アプリを紹介する" })).not.toBeInTheDocument();
    } finally {
      referral = async () => ({ url: "https://app.example/r/r_abcdefghijklmnopqrstuv", referredCount: 2 });
    }
  });
});
