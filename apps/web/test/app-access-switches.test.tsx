// 運営の画面の「アプリの利用」（specs/meguru/030-app-access FR-006、tasks.md T007）。
// 「運営者が開いた人だけ」のアプリが登録の一覧にあるときだけ、人（使える機能）とグループの詳しい画面に出す。変えたらすぐ保存する。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OperatorAppRegistry, OperatorUser, TestGroupDetail } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { THREADS_REGISTRY } from "./helpers/app-registry";
import { ME_BILLING_OFF } from "./helpers/billing";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  appRegistry: vi.fn(),
  featureSettings: vi.fn(),
  findOperatorUser: vi.fn(),
  putUserAppAccess: vi.fn(),
  testGroup: vi.fn(),
  putGroupAppAccess: vi.fn(),
}));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});

const { ApiError } = await import("@/lib/api-client");
const { FeaturesPage } = await import("@/shell/settings/features");
const { TestGroupDetailPage } = await import("@/shell/settings/test-groups");

/** 仮のアプリ（アプリの一覧にないので、名前は番号のまま出る）。 */
const DEMO = "demo-granted";

const WITH_GRANTED: OperatorAppRegistry = {
  apps: [...THREADS_REGISTRY.apps, { app: DEMO, access: "granted", featureSwitches: false, operatorLimits: false, features: [], limits: [] }],
};

const ME = {
  user: { id: "u", email: "op@example.com", displayName: null },
  accounts: [],
  landingAccountId: null,
  accountLimit: { max: null, used: 0 },
  threadsAccessMode: "testers" as const,
  threadsConnectMethods: ["token" as const],
  teams: [],
  ...ME_BILLING_OFF,
  operator: true,
};

const HANAKO: OperatorUser = {
  userId: "u-hanako",
  name: "山田 花子",
  email: "hanako@example.com",
  disabled: [],
  appAccess: [],
  group: null,
};

const DETAIL: TestGroupDetail = {
  id: "g1",
  name: "飲食の会",
  capacity: 10,
  memberCount: 0,
  inviteUrl: "https://app.test/test-invite/g_x",
  closedAt: null,
  createdAt: "2026-10-31T00:00:00.000Z",
  disabled: [],
  appAccess: [DEMO],
  members: [],
  events: [],
};

/**
 * 画面を出す。
 * @param path - 開くパス
 */
function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/settings/features", element: <FeaturesPage /> },
      { path: "/settings/test-groups/:groupId", element: <TestGroupDetailPage /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/**
 * 「使える機能」で花子を探す。
 * @param user - userEvent
 */
async function findHanako(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole("textbox", { name: "メールアドレス" }), "hanako@example.com");
  await user.click(screen.getByRole("button", { name: "探す" }));
  await screen.findByRole("group", { name: "山田 花子の使える機能" });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.me.mockResolvedValue(ME);
  mocks.featureSettings.mockResolvedValue({ users: [], events: [] });
  mocks.findOperatorUser.mockResolvedValue(HANAKO);
  mocks.testGroup.mockResolvedValue(DETAIL);
});

describe("人（使える機能）", () => {
  it("運営者が開いた人だけのアプリがなければ「アプリの利用」を出さない（今の画面と同じ）", async () => {
    const user = userEvent.setup();
    mocks.appRegistry.mockResolvedValue(THREADS_REGISTRY);
    renderAt("/settings/features");
    await findHanako(user);
    expect(screen.queryByRole("group", { name: "山田 花子のアプリの利用" })).toBeNull();
    expect(screen.queryByText("アプリの利用")).toBeNull();
  });

  it("あれば、アプリごとのスイッチを出し、変えるとすぐ PUT して「保存しました」。グループで開いていれば添える", async () => {
    const user = userEvent.setup();
    mocks.appRegistry.mockResolvedValue(WITH_GRANTED);
    mocks.findOperatorUser.mockResolvedValue({ ...HANAKO, group: { id: "g1", name: "飲食の会", disabled: [], appAccess: [DEMO] } });
    mocks.putUserAppAccess.mockResolvedValue({ granted: [DEMO] });
    renderAt("/settings/features");
    await findHanako(user);
    const group = within(await screen.findByRole("group", { name: "山田 花子のアプリの利用" }));
    const toggle = group.getByRole("switch", { name: DEMO });
    expect(toggle).not.toBeChecked();
    expect(group.getByText("グループで開いています")).toBeInTheDocument();
    await user.click(toggle);
    expect(mocks.putUserAppAccess).toHaveBeenCalledWith("u-hanako", { [DEMO]: true });
    expect(await group.findByText("保存しました")).toBeInTheDocument();
    expect(group.getByRole("switch", { name: DEMO })).toBeChecked();
  });

  it("保存できなければ、理由を出してスイッチを戻す", async () => {
    const user = userEvent.setup();
    mocks.appRegistry.mockResolvedValue(WITH_GRANTED);
    mocks.putUserAppAccess.mockRejectedValue(new ApiError("VALIDATION_FAILED", 400, ["apps"]));
    renderAt("/settings/features");
    await findHanako(user);
    const group = within(await screen.findByRole("group", { name: "山田 花子のアプリの利用" }));
    await user.click(group.getByRole("switch", { name: DEMO }));
    expect(await group.findByRole("alert")).toHaveTextContent("入力内容を確認してください。");
    expect(group.getByRole("switch", { name: DEMO })).not.toBeChecked();
  });
});

describe("グループの詳しい画面", () => {
  it("運営者が開いた人だけのアプリがなければ出さない", async () => {
    mocks.appRegistry.mockResolvedValue(THREADS_REGISTRY);
    renderAt("/settings/test-groups/g1");
    await screen.findByRole("group", { name: "飲食の会の使える機能" });
    expect(screen.queryByRole("group", { name: "飲食の会のアプリの利用" })).toBeNull();
  });

  it("あれば今の許可を出し、閉じるとすぐ PUT する", async () => {
    const user = userEvent.setup();
    mocks.appRegistry.mockResolvedValue(WITH_GRANTED);
    mocks.putGroupAppAccess.mockResolvedValue({ granted: [] });
    renderAt("/settings/test-groups/g1");
    const group = within(await screen.findByRole("group", { name: "飲食の会のアプリの利用" }));
    expect(group.getByRole("switch", { name: DEMO })).toBeChecked();
    await user.click(group.getByRole("switch", { name: DEMO }));
    expect(mocks.putGroupAppAccess).toHaveBeenCalledWith("g1", { [DEMO]: false });
    expect(await group.findByText("保存しました")).toBeInTheDocument();
    expect(group.getByRole("switch", { name: DEMO })).not.toBeChecked();
  });

  it("閉じたグループには出さない", async () => {
    mocks.appRegistry.mockResolvedValue(WITH_GRANTED);
    mocks.testGroup.mockResolvedValue({ ...DETAIL, closedAt: "2026-11-01T00:00:00.000Z", inviteUrl: null });
    renderAt("/settings/test-groups/g1");
    expect(await screen.findByText(/閉じています/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "飲食の会のアプリの利用" })).toBeNull();
  });
});
