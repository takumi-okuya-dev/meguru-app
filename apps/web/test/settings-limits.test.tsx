// 設定 > 運営 > 上限（specs/024-tester-invite-connect contracts/ui-routes.md 6、US3、T045）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OperatorLimitUser, OperatorLimits } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "./helpers/billing";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  operatorLimits: vi.fn(),
  putDefaultLimits: vi.fn(),
  findLimitUser: vi.fn(),
  putUserLimits: vi.fn(),
}));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});

const { ApiError } = await import("@/lib/api-client");
const { SettingsLayout } = await import("@/pages/settings/settings-layout");
const { LimitsPage } = await import("@/pages/settings/limits");

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

const LIMITS: OperatorLimits = {
  defaults: { accountLimit: 3, dailyPostLimit: 10 },
  overrides: [{ userId: "u-hanako", name: "山田 花子", email: "hanako@example.com", accountLimit: 5, dailyPostLimit: null }],
  events: [{ at: "2026-11-08T05:02:00.000Z", actor: "拓海", action: "user_limits", detail: null }],
};

const HANAKO: OperatorLimitUser = {
  userId: "u-hanako",
  name: "山田 花子",
  email: "hanako@example.com",
  operator: false,
  accountLimit: 5,
  dailyPostLimit: null,
  ownedAccountCount: 2,
};

function renderAt(path = "/settings/limits") {
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { path: "appearance", element: <p>外観の中身</p> },
          { path: "limits", element: <LimitsPage /> },
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
  mocks.operatorLimits.mockResolvedValue(LIMITS);
});

describe("「運営」の区分", () => {
  it("運営者には「上限」を出す（使える機能・グループ・テスター招待・上限の順）", async () => {
    renderAt("/settings/appearance");
    const link = await screen.findByRole("link", { name: "上限" });
    expect(link).toHaveAttribute("href", "/settings/limits");
    const hrefs = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs.indexOf("/settings/tester-invites")).toBeGreaterThan(-1);
    expect(hrefs.indexOf("/settings/tester-invites")).toBeLessThan(hrefs.indexOf("/settings/limits"));
  });

  it("運営者でなければ「運営者だけ」", async () => {
    mocks.me.mockResolvedValue({ ...ME, operator: false });
    mocks.operatorLimits.mockRejectedValue(new ApiError("OPERATOR_ONLY", 403));
    renderAt();
    expect(await screen.findByText("この画面は運営者だけが使えます。")).toBeInTheDocument();
  });
});

describe("全員の既定値", () => {
  it("今の値を出し、保存する", async () => {
    mocks.putDefaultLimits.mockResolvedValue({ accountLimit: 4, dailyPostLimit: 8 });
    renderAt();
    const section = (await screen.findByRole("heading", { name: "全員の既定値" })).closest("section")!;
    const account = await within(section).findByLabelText("アカウントの数");
    expect(account).toHaveValue(3);
    const user = userEvent.setup();
    await user.clear(account);
    await user.type(account, "4");
    const daily = within(section).getByLabelText("1日の投稿数（1アカウント）");
    await user.clear(daily);
    await user.type(daily, "8");
    await user.click(within(section).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.putDefaultLimits).toHaveBeenCalledWith({ accountLimit: 4, dailyPostLimit: 8 }));
  });
});

describe("人ごとの上限", () => {
  it("探すと「この人だけ」「既定値」を出し、保存・既定値に戻す", async () => {
    mocks.findLimitUser.mockResolvedValue(HANAKO);
    mocks.putUserLimits.mockResolvedValue({ ...HANAKO, accountLimit: null });
    renderAt();
    const user = userEvent.setup();
    const section = (await screen.findByRole("heading", { name: "人ごとの上限" })).closest("section")!;
    await user.type(within(section).getByLabelText("メールアドレス"), "hanako@example.com");
    await user.click(within(section).getByRole("button", { name: "探す" }));
    expect(await within(section).findByText("この人だけ")).toBeInTheDocument();
    expect(within(section).getByText("既定値（10件）")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "既定値に戻す" }));
    await waitFor(() => expect(mocks.putUserLimits).toHaveBeenCalledWith("u-hanako", { accountLimit: null, dailyPostLimit: null }));
  });

  it("運営者なら「運営者には上限をかけません」", async () => {
    mocks.findLimitUser.mockResolvedValue({ ...HANAKO, operator: true });
    renderAt();
    const user = userEvent.setup();
    const section = (await screen.findByRole("heading", { name: "人ごとの上限" })).closest("section")!;
    await user.type(within(section).getByLabelText("メールアドレス"), "op@example.com");
    await user.click(within(section).getByRole("button", { name: "探す" }));
    expect(await within(section).findByText("運営者には上限をかけません")).toBeInTheDocument();
  });

  it("見つからなければ「見つかりません」", async () => {
    mocks.findLimitUser.mockRejectedValue(new ApiError("USER_NOT_FOUND", 404));
    renderAt();
    const user = userEvent.setup();
    const section = (await screen.findByRole("heading", { name: "人ごとの上限" })).closest("section")!;
    await user.type(within(section).getByLabelText("メールアドレス"), "x@example.com");
    await user.click(within(section).getByRole("button", { name: "探す" }));
    expect(await within(section).findByText("見つかりません")).toBeInTheDocument();
  });
});

describe("既定値と違う人・記録", () => {
  it("一覧と、閉じた記録のトグル", async () => {
    renderAt();
    expect(await screen.findByText("アカウント5件・投稿は既定値")).toBeInTheDocument();
    expect(screen.getByText("運営者には上限をかけません。")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /変更の記録/ }));
    expect(await screen.findByText(/人ごとの上限を変えた（拓海）/)).toBeInTheDocument();
  });
});
