// 設定 > 運営 > 使える機能（specs/019-feature-switches contracts/ui-routes.md 4、US1・US4）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FeatureSettingsList, OperatorUser } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "./helpers/billing";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  featureSettings: vi.fn(),
  findOperatorUser: vi.fn(),
  putFeatureSettings: vi.fn(),
  resetFeatureSettings: vi.fn(),
}));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  const { THREADS_REGISTRY } = await import("./helpers/app-registry");
  return { ...actual, api: { ...actual.api, ...mocks, appRegistry: async () => THREADS_REGISTRY } };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, ...mocks } };
});

const { ApiError } = await import("@/lib/api-client");
const { SettingsLayout } = await import("@/shell/settings/settings-layout");
const { FeaturesPage } = await import("@/shell/settings/features");

const ME = {
  user: { id: "u", email: "op@example.com", displayName: null },
  accounts: [],
  landingAccountId: null,
  accountLimit: { max: null, used: 0 },
  threadsAccessMode: "testers" as const,
  threadsConnectMethods: ["token" as const],
  teams: [],
  ...ME_BILLING_OFF,
};

const HANAKO: OperatorUser = {
  userId: "u-hanako",
  name: "山田 花子",
  email: "hanako@example.com",
  disabled: ["strategy"],
  group: { id: "g1", name: "飲食の会", disabled: ["team"] },
};

const LIST: FeatureSettingsList = {
  users: [{ userId: "u-hanako", name: "山田 花子", email: "hanako@example.com", disabled: ["strategy"], updatedAt: "2026-11-04T05:02:00.000Z" }],
  events: [
    { feature: "strategy", action: "disabled", actorName: "拓海", subjectName: "山田 花子", subjectKind: "user", createdAt: "2026-11-04T05:02:00.000Z" },
    { feature: "team", action: "disabled", actorName: "拓海", subjectName: "飲食の会", subjectKind: "group", createdAt: "2026-11-03T05:00:00.000Z" },
  ],
};

function renderAt(path = "/settings/features") {
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { path: "appearance", element: <p>外観の中身</p> },
          { path: "features", element: <FeaturesPage /> },
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
  mocks.featureSettings.mockResolvedValue(LIST);
});

describe("「運営」の区分", () => {
  it("運営者なら、招待制がOFFでも「使える機能」と「グループ」を出す", async () => {
    renderAt("/settings/appearance");
    expect(await screen.findByRole("link", { name: "使える機能" })).toHaveAttribute("href", "/settings/features");
    expect(screen.getByRole("link", { name: "グループ" })).toBeInTheDocument();
  });

  it("運営者でなければ出さず、直接開くと「運営者だけ」", async () => {
    mocks.me.mockResolvedValue({ ...ME, operator: false });
    mocks.featureSettings.mockRejectedValue(new ApiError("OPERATOR_ONLY", 403));
    renderAt();
    expect(await screen.findByText("この画面は運営者だけが使えます。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "使える機能" })).toBeNull();
  });
});

describe("人を探して切り替える", () => {
  it("見つかった人の名前・グループと3つのスイッチ。グループでOFFのまとまりに「グループでOFF」", async () => {
    const user = userEvent.setup();
    mocks.findOperatorUser.mockResolvedValue(HANAKO);
    renderAt();
    await user.type(await screen.findByRole("textbox", { name: "メールアドレス" }), " hanako@example.com ");
    await user.click(screen.getByRole("button", { name: "探す" }));
    expect(mocks.findOperatorUser).toHaveBeenCalledWith("hanako@example.com");
    expect(await screen.findByText("hanako@example.com · グループ：飲食の会")).toBeInTheDocument();
    const group = within(screen.getByRole("group", { name: "山田 花子の使える機能" }));
    expect(group.getByRole("switch", { name: "自動投稿" })).toBeChecked();
    expect(group.getByRole("switch", { name: "戦略" })).not.toBeChecked();
    expect(group.getByRole("switch", { name: "チーム" })).toBeChecked();
    expect(group.getByText("グループでOFF")).toBeInTheDocument();
  });

  it("スイッチを変えて「保存」すると PUT に3つの値が渡り、「保存しました」。ボタンの文言は変わらない", async () => {
    const user = userEvent.setup();
    mocks.findOperatorUser.mockResolvedValue(HANAKO);
    mocks.putFeatureSettings.mockResolvedValue({ ...HANAKO, disabled: ["autopost", "strategy"] });
    renderAt();
    await user.type(await screen.findByRole("textbox", { name: "メールアドレス" }), "hanako@example.com");
    await user.click(screen.getByRole("button", { name: "探す" }));
    const group = within(await screen.findByRole("group", { name: "山田 花子の使える機能" }));
    await user.click(group.getByRole("switch", { name: "自動投稿" }));
    await user.click(group.getByRole("button", { name: "保存" }));
    expect(mocks.putFeatureSettings).toHaveBeenCalledWith("u-hanako", { autopost: false, strategy: false, team: true });
    expect(await screen.findByText("保存しました")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
  });

  it("見つからなければ「見つかりません」", async () => {
    const user = userEvent.setup();
    mocks.findOperatorUser.mockRejectedValue(new ApiError("USER_NOT_FOUND", 404));
    renderAt();
    await user.type(await screen.findByRole("textbox", { name: "メールアドレス" }), "nobody@example.com");
    await user.click(screen.getByRole("button", { name: "探す" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("見つかりません");
  });
});

describe("OFFの人と最近の変更（US4）", () => {
  it("OFFの人の一覧（名前・メールアドレス・OFFのまとまり・最後に変えた日）。いなければ「OFFの人はいません」", async () => {
    renderAt();
    expect(await screen.findByText("戦略 · 11/4")).toBeInTheDocument();
    expect(screen.getByText("hanako@example.com")).toBeInTheDocument();
  });

  it("いなければ「OFFの人はいません」", async () => {
    mocks.featureSettings.mockResolvedValue({ users: [], events: [] });
    renderAt();
    expect(await screen.findByText("OFFの人はいません")).toBeInTheDocument();
  });

  it("「すべてONに戻す」で確認のダイアログが出て、確かめると DELETE が呼ばれる", async () => {
    const user = userEvent.setup();
    mocks.resetFeatureSettings.mockResolvedValue({ ...HANAKO, disabled: [] });
    renderAt();
    await user.click(await screen.findByRole("button", { name: "すべてONに戻す" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("山田 花子さんを、すべてONに戻しますか？")).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "すべてONに戻す" }));
    expect(mocks.resetFeatureSettings).toHaveBeenCalledWith("u-hanako");
  });

  it("「最近の変更」と「この画面について」は閉じたトグルで、開くと人とグループの変更・箇条書きが出る", async () => {
    const user = userEvent.setup();
    renderAt();
    const changes = await screen.findByRole("button", { name: "最近の変更" });
    expect(changes).toHaveAttribute("aria-expanded", "false");
    await user.click(changes);
    const region = within(screen.getByRole("region", { name: "最近の変更" }));
    expect(region.getByText("山田 花子の戦略をOFF（拓海）")).toBeInTheDocument();
    expect(region.getByText("飲食の会のチームをOFF（拓海）")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "この画面について" }));
    expect(within(screen.getByRole("region", { name: "この画面について" })).getByText(/グループでOFFの機能は/)).toBeInTheDocument();
  });
});
