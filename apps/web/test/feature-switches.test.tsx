// 機能のまとまりが使えないときの画面の出し分け（specs/019-feature-switches contracts/ui-routes.md 1〜3、FR-004・FR-006・FR-009・FR-012）。
// 「自動投稿」「戦略」は開いているAccountのオーナーの /access の features、「チーム」は自分の /api/me の features で出し分ける。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { AccountAccessResponse, Feature, MeResponse, ProfileStatus } from "@threads-grower/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_FEATURES, OWNER_ACCESS, VIEWER_ACCESS } from "./helpers/access";
import { ME_BILLING_OFF } from "./helpers/billing";
import { account, listResponse, promptResponse, renderAccountRoutes } from "./helpers/stock";

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { fullName: "Takumi", primaryEmailAddress: { emailAddress: "t@example.com" } } }),
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  accountAccess: vi.fn(),
  account: vi.fn(),
  getTeam: vi.fn(),
  getDraftCounts: vi.fn(),
  getAutoPost: vi.fn(),
  referral: vi.fn(),
  getProfileStatus: vi.fn(),
  listPostDrafts: vi.fn(),
  listPublished: vi.fn(),
  getPrompt: vi.fn(),
  getStrategy: vi.fn(),
  listPromotions: vi.fn(),
  listReferencePosts: vi.fn(),
  listResearchKeywords: vi.fn(),
}));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});

const { AppShell } = await import("@/components/layout/AppShell");
const { PageHeader } = await import("@/components/layout/PageHeader");
const { AccountHome } = await import("@/pages/account-home");
const { CreatePage } = await import("@/pages/create");
const { StrategyPage } = await import("@/pages/strategy");
const { StockPage } = await import("@/pages/stock");
const { TeamSharedAccountPage } = await import("@/pages/team-shared-account");
const { RequireFeature } = await import("@/components/FeatureUnavailable");
const { ApiError } = await import("@/lib/api-client");

/** 指定したまとまりだけが使えない、オーナーの関わりと権限。 */
const ownerWithout = (...off: Feature[]): AccountAccessResponse => ({
  ...OWNER_ACCESS,
  features: ALL_FEATURES.filter((f) => !off.includes(f)),
});

const ME: MeResponse = {
  user: { id: "u", email: "t@example.com", displayName: "Takumi" },
  accounts: [{ ...account, id: "a1" }],
  landingAccountId: "a1",
  accountLimit: { max: 5, used: 1 },
  ...ME_BILLING_OFF,
  threadsAccessMode: "testers",
  threadsConnectMethods: ["app", "token"],
  teams: [{ id: "t1", name: "飲食チーム", memberCount: 3, role: "member" }],
};

const STATUS: ProfileStatus = {
  strategy: { filledCount: 16, totalCount: 16 },
  promotions: { targetableCount: 1, totalCount: 1 },
  research: { referencePostCount: 1, keywordCount: 0 },
  access: { canEdit: true, inTrial: false, trialEndsAt: null, trialDaysLeft: null },
};

let access: AccountAccessResponse;
beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  access = OWNER_ACCESS;
  mocks.accountAccess.mockImplementation(() => Promise.resolve(access));
  mocks.me.mockResolvedValue(ME);
  mocks.getDraftCounts.mockResolvedValue({ needsReview: 0, approved: 0, rejected: 0, published: 0, publishFailed: 0 });
  mocks.getAutoPost.mockResolvedValue({ autoPost: { enabled: false, slotCount: 0, stoppedReason: null }, next: null, approvedCount: 0, daysLeft: null, notices: [] });
  mocks.referral.mockResolvedValue({ url: "https://app.example/r/r_x", referredCount: 0 });
  mocks.getProfileStatus.mockResolvedValue(STATUS);
  mocks.listPostDrafts.mockResolvedValue(listResponse());
  mocks.getPrompt.mockResolvedValue(promptResponse());
});

function renderShell(path = "/accounts/a1") {
  const shell = (
    <AppShell>
      <PageHeader title="画面" />
      <p>中身</p>
    </AppShell>
  );
  const router = createMemoryRouter([{ path: "/accounts/:accountId/*", element: shell }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const nav = async () => within(await screen.findByRole("navigation", { name: "このアカウント" }));
const links = (n: ReturnType<typeof within>) => n.getAllByRole("link").map((l: HTMLElement) => l.textContent?.replace(/\s+/g, ""));

describe("サイドバー", () => {
  it("すべて使えるなら、ホーム → 自動投稿 → 戦略 → チーム の順。「分析」の見出しはない", async () => {
    renderShell();
    const n = await nav();
    await n.findByRole("link", { name: /飲食チーム/ });
    expect(links(n)).toEqual(["ホーム", "投稿をつくる", "投稿ストック", "パフォーマンス", "解析", "課題", "宣伝内容", "外部媒体展開", "リサーチ", "飲飲食チーム3人"]);
    expect(n.getByText("自動投稿")).toBeInTheDocument();
    expect(n.getByText("戦略")).toBeInTheDocument();
    expect(n.queryByText("分析")).toBeNull();
  });

  it("自動投稿・戦略を使えないAccountでは、その区分（見出しと項目）ごと出ない。鍵の印や「使えません」も出ない", async () => {
    access = ownerWithout("autopost", "strategy");
    renderShell();
    const n = await nav();
    await vi.waitFor(() => expect(n.queryByRole("link", { name: "投稿をつくる" })).toBeNull());
    expect(links(n)).toEqual(["ホーム", "飲飲食チーム3人"]);
    expect(n.queryByText("自動投稿")).toBeNull();
    expect(n.queryByText("戦略")).toBeNull();
    expect(screen.queryByText(/使えません/)).toBeNull();
    expect(mocks.getDraftCounts).not.toHaveBeenCalled();
  });

  it("自分がチームを使えなければ、「チーム」の区分が出ない", async () => {
    mocks.me.mockResolvedValue({ ...ME, features: ["autopost", "strategy"] });
    renderShell();
    const n = await nav();
    await n.findByRole("link", { name: "課題" });
    expect(n.queryByRole("link", { name: /飲食チーム/ })).toBeNull();
  });
});

describe("ホーム", () => {
  function renderHome() {
    const router = createMemoryRouter(
      [{ path: "/accounts/:accountId", element: <Outlet context={{ account: { ...account, id: "a1" } }} />, children: [{ index: true, element: <AccountHome /> }] }],
      { initialEntries: ["/accounts/a1"] },
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  it("すべて使えるなら、今までどおり「投稿をつくりましょう」と3枚のカードが出る", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: "投稿をつくりましょう" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "投稿の材料" })).toBeInTheDocument();
    expect(mocks.getAutoPost).toHaveBeenCalled();
  });

  it("戦略を使えなければ、入力状況のカードと、課題・宣伝内容・リサーチの案内が出ない", async () => {
    access = ownerWithout("strategy");
    mocks.getProfileStatus.mockResolvedValue({ ...STATUS, strategy: { filledCount: 0, totalCount: 16 } });
    renderHome();
    expect(await screen.findByRole("heading", { name: "投稿をつくりましょう" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "投稿の材料" })).toBeNull();
    expect(screen.queryByRole("link", { name: /課題|宣伝内容|リサーチ/ })).toBeNull();
  });

  it("自動投稿を使えなければ、「投稿をつくりましょう」と次の投稿・自動投稿の知らせが出ず、そのAPIも呼ばない", async () => {
    access = ownerWithout("autopost");
    renderHome();
    expect(await screen.findByRole("navigation", { name: "投稿の材料" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "投稿をつくりましょう" })).toBeNull();
    expect(screen.queryByRole("link", { name: "投稿をつくる" })).toBeNull();
    expect(mocks.getAutoPost).not.toHaveBeenCalled();
  });
});

describe("投稿をつくる", () => {
  it("戦略を使えない（materials が null）なら、情報の欄・課題の案内・材料を埋める手順が出ない", async () => {
    access = ownerWithout("strategy");
    mocks.getPrompt.mockResolvedValue({ ...promptResponse(), materials: null });
    renderAccountRoutes([{ path: "create", element: <CreatePage /> }], "/accounts/a1/create");
    expect(await screen.findByRole("region", { name: "プロンプト" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "投稿ができるまでの4つの手順" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /プロンプトに入っている情報/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /課題|宣伝内容|リサーチ/ })).toBeNull();
  });
});

describe("チームで見せてもらっている画面（オーナーの設定に従う）", () => {
  function renderShared() {
    const router = createMemoryRouter(
      [
        { path: "/teams/:teamId/accounts/:accountId", element: <TeamSharedAccountPage /> },
        { path: "/teams/:teamId", element: <p>チームの画面</p> },
      ],
      { initialEntries: ["/teams/team-1/accounts/acc-1?tab=strategy"] },
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    mocks.account.mockResolvedValue({ ...account, id: "acc-1", role: "viewer", ownerName: "鈴木 花子" });
    mocks.getTeam.mockResolvedValue({ id: "team-1", name: "飲食チーム", myRole: "member", admin: { userId: "u", name: "田中 健" }, members: [], limits: { members: 50, editors: 10 } });
    mocks.listPublished.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("オーナーの戦略が使えなければ、戦略のタブを出さず、その3つのAPIを呼ばない。投稿ストックは開ける", async () => {
    access = { ...VIEWER_ACCESS, features: ["autopost", "team"] };
    renderShared();
    expect(await screen.findByRole("button", { name: "投稿ストック" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "戦略" })).toBeNull();
    expect(mocks.getStrategy).not.toHaveBeenCalled();
    expect(mocks.listPromotions).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("オーナーの自動投稿が使えなければ、投稿ストックのタブを出さず、投稿ストックを読まない", async () => {
    access = { ...VIEWER_ACCESS, features: ["strategy", "team"] };
    mocks.getStrategy.mockResolvedValue({});
    mocks.listPromotions.mockResolvedValue({ items: [], limit: 20, canEdit: false });
    mocks.listReferencePosts.mockResolvedValue({ items: [], limit: 200, canEdit: false });
    mocks.listResearchKeywords.mockResolvedValue({ items: [], limit: 50, canEdit: false });
    renderShared();
    expect(await screen.findByRole("button", { name: "戦略" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "投稿ストック" })).toBeNull();
    expect(mocks.listPostDrafts).not.toHaveBeenCalled();
  });
});

describe("使えない機能を直接開いたとき（FR-006）", () => {
  it("使えないとわかっていれば、画面を作らず「この機能は今は使えません」を出す", async () => {
    access = ownerWithout("autopost", "strategy");
    renderAccountRoutes(
      [
        { path: "strategy", element: <RequireFeature feature="strategy"><StrategyPage /></RequireFeature> },
        { path: "stock", element: <RequireFeature feature="autopost"><StockPage /></RequireFeature> },
      ],
      "/accounts/a1/stock",
    );
    expect(await screen.findByRole("heading", { name: "この機能は今は使えません" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ホームへ" })).toHaveAttribute("href", "/accounts/a1");
    expect(mocks.listPostDrafts).not.toHaveBeenCalled();
  });

  it("開いている間に使えなくなり、APIが FEATURE_DISABLED を返したときも同じ画面を出す", async () => {
    mocks.getStrategy.mockRejectedValue(new ApiError("FEATURE_DISABLED", 403, ["strategy"]));
    renderAccountRoutes(
      [{ path: "strategy", element: <RequireFeature feature="strategy"><StrategyPage /></RequireFeature> }],
      "/accounts/a1/strategy",
    );
    expect(await screen.findByRole("heading", { name: "この機能は今は使えません" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再読み込み" })).toBeNull();
  });
});
