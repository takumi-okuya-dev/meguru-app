// 設定 > 運営 > グループ（specs/016-test-groups contracts/ui-routes.md 3、US2、T024・T025。specs/019 で「グループ」に改名し、使える機能を足した）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TestGroupDetail } from "@meguru/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "./helpers/billing";

const me = vi.fn();
const testGroups = vi.fn();
const createTestGroup = vi.fn();
const testGroup = vi.fn();
const removeTestGroupMember = vi.fn();
const closeTestGroup = vi.fn();
const putTestGroupFeatures = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { ...actual.api, me, testGroups, createTestGroup, testGroup, removeTestGroupMember, closeTestGroup, putTestGroupFeatures },
  };
});

const { ApiError } = await import("@/lib/api-client");
const { SettingsLayout } = await import("@/shell/settings/settings-layout");
const { TestGroupsPage, TestGroupDetailPage } = await import("@/shell/settings/test-groups");

const ME = {
  user: { id: "u", email: "u@example.com", displayName: null },
  accounts: [],
  landingAccountId: null,
  accountLimit: { max: null, used: 0 },
  threadsAccessMode: "testers" as const,
  threadsConnectMethods: ["token" as const],
  teams: [],
  ...ME_BILLING_OFF,
};

const DETAIL: TestGroupDetail = {
  id: "g1",
  name: "飲食の会",
  capacity: 2,
  memberCount: 2,
  inviteUrl: "https://app.test/test-invite/g_x",
  closedAt: null,
  createdAt: "2026-10-31T00:00:00.000Z",
  disabled: [],
  members: [
    { userId: "m1", name: "鈴木", email: "suzuki@example.com", joinedAt: "2026-10-31T01:00:00.000Z" },
    { userId: "m2", name: "佐藤", email: "sato@example.com", joinedAt: "2026-10-31T02:00:00.000Z" },
  ],
  events: [{ action: "member_joined", actorName: "佐藤", subjectName: "佐藤", details: null, createdAt: "2026-10-31T02:00:00.000Z" }],
};

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { path: "appearance", element: <p>外観の中身</p> },
          { path: "test-groups", element: <TestGroupsPage /> },
          { path: "test-groups/:groupId", element: <TestGroupDetailPage /> },
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
  return router;
}

beforeEach(() => {
  for (const fn of [me, testGroups, createTestGroup, testGroup, removeTestGroupMember, closeTestGroup, putTestGroupFeatures]) fn.mockReset();
});

describe("「運営」の区分", () => {
  it("運営者にだけ「グループ」と「使える機能」を出す（specs/019 で項目名を「グループ」にした）", async () => {
    me.mockResolvedValue({ ...ME, testGroups: { enabled: true, admitted: true, operator: true }, operator: true });
    renderAt("/settings/appearance");
    expect(await screen.findByRole("link", { name: "グループ" })).toHaveAttribute("href", "/settings/test-groups");
    expect(screen.getByRole("link", { name: "使える機能" })).toHaveAttribute("href", "/settings/features");
  });

  it("運営者でなければ出さない", async () => {
    me.mockResolvedValue({ ...ME, testGroups: { enabled: true, admitted: true, operator: false } });
    renderAt("/settings/appearance");
    await screen.findByText("外観の中身");
    expect(screen.queryByRole("link", { name: "グループ" })).not.toBeInTheDocument();
  });

  it("運営者でない人が直接開くと「運営者だけ」", async () => {
    me.mockResolvedValue({ ...ME, testGroups: { enabled: true, admitted: true, operator: false } });
    testGroups.mockRejectedValue(new ApiError("OPERATOR_ONLY", 403));
    renderAt("/settings/test-groups");
    expect(await screen.findByText("この画面は運営者だけが使えます。")).toBeInTheDocument();
  });

  it("運営者でも、読み込めなかったときはエラーの中身を出す（「運営者だけ」と言わない）", async () => {
    me.mockResolvedValue({ ...ME, testGroups: { enabled: true, admitted: true, operator: true }, operator: true });
    testGroups.mockRejectedValue(new ApiError("API_UNREACHABLE", 0));
    renderAt("/settings/test-groups");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("この画面は運営者だけが使えます。")).not.toBeInTheDocument();
  });

  it("グループが見つからないときは、その旨を出す", async () => {
    me.mockResolvedValue({ ...ME, testGroups: { enabled: true, admitted: true, operator: true }, operator: true });
    testGroup.mockRejectedValue(new ApiError("ITEM_NOT_FOUND", 404));
    renderAt("/settings/test-groups/g1");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("この画面は運営者だけが使えます。")).not.toBeInTheDocument();
  });
});

describe("一覧", () => {
  beforeEach(() => {
    me.mockResolvedValue({ ...ME, testGroups: { enabled: true, admitted: true, operator: true }, operator: true });
  });

  it("グループごとに人数／上限、定員、閉じたものを出す", async () => {
    testGroups.mockResolvedValue({
      groups: [
        { id: "g1", name: "飲食の会", capacity: 2, memberCount: 2, inviteUrl: "u", closedAt: null, createdAt: "2026-10-31T00:00:00Z" },
        { id: "g2", name: "美容の会", capacity: 5, memberCount: 0, inviteUrl: null, closedAt: "2026-10-31T00:00:00Z", createdAt: "2026-10-30T00:00:00Z" },
      ],
    });
    renderAt("/settings/test-groups");
    expect(await screen.findByText("2／2人（定員）")).toBeInTheDocument();
    expect(screen.getByText("閉じています")).toBeInTheDocument();
  });

  it("「グループを作る」で名前と上限を入れて作り、詳しい画面へ移る", async () => {
    testGroups.mockResolvedValue({ groups: [] });
    createTestGroup.mockResolvedValue({ ...DETAIL, id: "g9" });
    testGroup.mockResolvedValue({ ...DETAIL, id: "g9" });
    const user = userEvent.setup();
    const router = renderAt("/settings/test-groups");
    expect(await screen.findByText(/まだグループはありません/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "グループを作る" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/グループ名/), "飲食の会");
    const cap = within(dialog).getByLabelText(/人数の上限/);
    await user.clear(cap);
    await user.type(cap, "3");
    await user.click(within(dialog).getByRole("button", { name: "作る" }));
    expect(createTestGroup).toHaveBeenCalledWith({ name: "飲食の会", capacity: 3 });
    await screen.findByRole("heading", { name: "飲食の会" });
    expect(router.state.location.pathname).toBe("/settings/test-groups/g9");
  });
});

describe("詳しい画面", () => {
  beforeEach(() => {
    me.mockResolvedValue({ ...ME, testGroups: { enabled: true, admitted: true, operator: true }, operator: true });
    testGroup.mockResolvedValue(DETAIL);
  });

  it("人数・招待リンク・入っている人・記録を出す", async () => {
    renderAt("/settings/test-groups/g1");
    expect(await screen.findByText("2／2人（定員）")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "招待リンク" })).toHaveValue("https://app.test/test-invite/g_x");
    expect(screen.getByText("suzuki@example.com · 2026年10月31日に入りました")).toBeInTheDocument();
    expect(screen.getByText("佐藤さんが入りました")).toBeInTheDocument();
  });

  it("「外す」は確かめてから外す", async () => {
    removeTestGroupMember.mockResolvedValue({ ...DETAIL, memberCount: 1, members: [DETAIL.members[1]!] });
    const user = userEvent.setup();
    renderAt("/settings/test-groups/g1");
    await user.click((await screen.findAllByRole("button", { name: "外す" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("鈴木さんをグループから外しますか？")).toBeInTheDocument();
    expect(within(dialog).getByText(/自動投稿も止まります/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "外す" }));
    expect(removeTestGroupMember).toHaveBeenCalledWith("g1", "m1");
    expect(await screen.findByText("1／2人")).toBeInTheDocument();
  });

  it("「グループを閉じる」は人数を出して確かめる。閉じたらリンクと閉じるボタンが消える", async () => {
    closeTestGroup.mockResolvedValue({ ...DETAIL, memberCount: 0, members: [], inviteUrl: null, closedAt: "2026-11-01T00:00:00.000Z" });
    const user = userEvent.setup();
    renderAt("/settings/test-groups/g1");
    await user.click(await screen.findByRole("button", { name: "グループを閉じる" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/入っている2人は全員テスト版を使えなくなり/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "グループを閉じる" }));
    expect(await screen.findByText(/閉じています/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "招待リンク" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "グループを閉じる" })).not.toBeInTheDocument();
  });
});

describe("グループの使える機能（specs/019 contracts/ui-routes.md 5）", () => {
  it("3つのスイッチ（今の設定）と保存。保存すると PUT に3つの値が渡り、「保存しました」", async () => {
    const user = userEvent.setup();
    me.mockResolvedValue({ ...ME, operator: true });
    testGroup.mockResolvedValue({ ...DETAIL, disabled: ["strategy"] });
    putTestGroupFeatures.mockResolvedValue({ ...DETAIL, disabled: ["strategy", "team"] });
    renderAt("/settings/test-groups/g1");
    const group = within(await screen.findByRole("group", { name: "飲食の会の使える機能" }));
    expect(group.getByRole("switch", { name: "自動投稿" })).toBeChecked();
    expect(group.getByRole("switch", { name: "戦略" })).not.toBeChecked();
    await user.click(group.getByRole("switch", { name: "チーム" }));
    await user.click(group.getByRole("button", { name: "保存" }));
    expect(putTestGroupFeatures).toHaveBeenCalledWith("g1", { autopost: true, strategy: false, team: false });
    expect(await screen.findByText("保存しました")).toBeInTheDocument();
    expect(group.getByRole("button", { name: "保存" })).toBeInTheDocument();
  });

  it("閉じたグループには出さない。招待リンクの「テスト版を使えます」は、テスト版でだけ出す", async () => {
    me.mockResolvedValue({ ...ME, operator: true });
    testGroup.mockResolvedValue({ ...DETAIL, closedAt: "2026-11-01T00:00:00.000Z", inviteUrl: null });
    renderAt("/settings/test-groups/g1");
    await screen.findByRole("heading", { name: "飲食の会" });
    expect(screen.queryByRole("group", { name: /使える機能/ })).toBeNull();
  });

  it("本番（招待制がOFF）では、招待リンクにテスト版の説明を出さない", async () => {
    me.mockResolvedValue({ ...ME, operator: true });
    testGroup.mockResolvedValue(DETAIL);
    renderAt("/settings/test-groups/g1");
    await screen.findByRole("heading", { name: "招待リンク" });
    expect(screen.queryByText(/テスト版を使えます/)).toBeNull();
  });
});
