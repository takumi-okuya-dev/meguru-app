// 時間差のメンション：投稿ストックのカード（specs/023 contracts/ui-routes.md、tasks.md T017・T025・T032）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MentionSettings, PostMention, PublishedPost } from "@meguru/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_ACCESS, OWNER_ACCESS } from "./helpers/access";
import { account, draft, listResponse } from "./helpers/stock";

const mocks = vi.hoisted(() => ({
  accountAccess: vi.fn(),
  listPostDrafts: vi.fn(),
  listPublished: vi.fn(),
  getAutoPost: vi.fn(),
  mentionSettings: vi.fn(),
  attachMention: vi.fn(),
  attachMentionsBulk: vi.fn(),
  detachMention: vi.fn(),
}));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { StockPage } = await import("@/apps/threads/pages/stock");

const SETTINGS: MentionSettings = {
  message: "シェアお願いします",
  delayMinutes: 30,
  version: 1,
  people: [
    { id: "p1", username: "minato_place", label: "港の運営", always: true, pendingCount: 0 },
    { id: "p2", username: "taro", label: "たろう", always: true, pendingCount: 0 },
    { id: "p3", username: "hanako", label: "はなこ", always: false, pendingCount: 0 },
    { id: "p4", username: "jiro", label: "じろう", always: false, pendingCount: 1 },
  ],
  repliesDenied: false,
  blocked: [{ username: "jiro", draftId: "other", reason: "recent" }],
  canEdit: true,
};
const pending = (over: Partial<PostMention> = {}): PostMention => ({
  usernames: ["minato_place", "taro"],
  text: "シェアお願いします\n@minato_place @taro",
  delayMinutes: 30,
  state: "pending",
  dueAt: null,
  sentAt: null,
  failureReason: null,
  replyPermalink: null,
  ...over,
});
const published = (over: Partial<PublishedPost> = {}): PublishedPost => ({
  id: "pub1",
  body: "公開した本文",
  publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
  threadsMediaId: "m1",
  threadsPermalink: "https://www.threads.com/@shop/post/m1",
  version: 3,
  mention: null,
  ...over,
});

function renderPage(path = "/accounts/a1/stock") {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: (
          <UnsavedChangesProvider>
            <Outlet context={{ account }} />
          </UnsavedChangesProvider>
        ),
        children: [{ path: "stock", element: <StockPage /> }],
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

const card = async (text: string) => (await screen.findByText(text)).closest("li")!;

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.accountAccess.mockResolvedValue(OWNER_ACCESS);
  mocks.getAutoPost.mockResolvedValue({ autoPost: { enabled: false, slotCount: 0, stoppedReason: null }, next: null, approvedCount: 0, daysLeft: null, notices: [] });
  mocks.mentionSettings.mockResolvedValue(SETTINGS);
  mocks.listPublished.mockResolvedValue({ items: [], nextCursor: null });
  mocks.attachMention.mockImplementation(async (_a: string, id: string) => ({ draft: draft({ id }), blocked: [] }));
});

describe("要確認のカード（T017）", () => {
  it("「メンションを付ける」の1回で、いつも付けるの人で保存する（SC-007）", async () => {
    const user = userEvent.setup();
    mocks.listPostDrafts.mockResolvedValue(listResponse({ items: [draft({ id: "d1", version: 2 })] }));
    renderPage();
    const li = await card("下書きの本文");
    await user.click(await within(li).findByRole("button", { name: "メンションを付ける" }));
    expect(mocks.attachMention).toHaveBeenCalledWith("a1", "d1", { expectedVersion: 2, usernames: ["minato_place", "taro"] });
  });

  it("付いている下書き：見出し・丸いボタン（選べない人は理由つきで押せない）・文。丸いボタンで文を直して保存", async () => {
    const user = userEvent.setup();
    mocks.listPostDrafts.mockResolvedValue(listResponse({ items: [draft({ id: "d1", version: 2, mention: pending() })] }));
    renderPage();
    const group = await screen.findByRole("group", { name: "時間差でメンション" });
    expect(within(group).getByText("投稿の30分後にメンション")).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /港の運営/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: /じろう（24時間以内に済み）/ })).toBeDisabled();
    await user.click(within(group).getByRole("button", { name: "はなこ" }));
    expect(mocks.attachMention).toHaveBeenCalledWith("a1", "d1", {
      expectedVersion: 2,
      usernames: ["minato_place", "taro", "hanako"],
      text: "シェアお願いします\n@minato_place @taro @hanako",
    });
  });

  it("文を直す → 文を保存。外す", async () => {
    const user = userEvent.setup();
    mocks.detachMention.mockResolvedValue({ draft: draft({ id: "d1" }) });
    mocks.listPostDrafts.mockResolvedValue(listResponse({ items: [draft({ id: "d1", version: 2, mention: pending() })] }));
    renderPage();
    const group = await screen.findByRole("group", { name: "時間差でメンション" });
    await user.click(within(group).getByRole("button", { name: "文を直す" }));
    const box = within(group).getByLabelText("返信の文");
    await user.clear(box);
    await user.type(box, "ぜひ @taro");
    await user.click(within(group).getByRole("button", { name: "文を保存" }));
    expect(mocks.attachMention).toHaveBeenCalledWith("a1", "d1", { expectedVersion: 2, usernames: ["taro"], text: "ぜひ @taro" });
    await user.click(within(group).getByRole("button", { name: "外す" }));
    expect(mocks.detachMention).toHaveBeenCalledWith("a1", "d1", 2);
  });

  it("返信の文にNGワードがあると知らせ、承認できない", async () => {
    mocks.listPostDrafts.mockResolvedValue(
      listResponse({
        items: [draft({ id: "d1", mention: pending({ text: "絶対シェア @taro", usernames: ["taro"] }) })],
        ngWords: [{ id: "n1", word: "絶対", normalized: "絶対", createdAt: "2026-10-01T00:00:00.000Z" }],
      }),
    );
    renderPage();
    expect(await screen.findByText("返信の文にNGワード「絶対」があります")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /を承認$/ })).toBeDisabled();
  });

  it("選んだときの「メンションを付ける」でまとめて付ける", async () => {
    const user = userEvent.setup();
    mocks.attachMentionsBulk.mockResolvedValue({ updated: [], skipped: [] });
    mocks.listPostDrafts.mockResolvedValue(listResponse({ items: [draft({ id: "d1", version: 2 }), draft({ id: "d2", version: 5, body: "二つ目" })] }));
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: /下書きの本文/ }));
    const bar = screen.getByRole("toolbar", { name: "選んだ下書きの操作" });
    await user.click(within(bar).getByRole("button", { name: "メンションを付ける" }));
    expect(mocks.attachMentionsBulk).toHaveBeenCalledWith("a1", [{ id: "d1", expectedVersion: 2 }]);
  });

  it("人がいない・返信の権限がない・承認できない人には出さない", async () => {
    mocks.listPostDrafts.mockResolvedValue(listResponse({ items: [draft({ id: "d1" })] }));
    mocks.mentionSettings.mockResolvedValue({ ...SETTINGS, repliesDenied: true });
    renderPage();
    await card("下書きの本文");
    await waitFor(() => expect(mocks.mentionSettings).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "メンションを付ける" })).not.toBeInTheDocument();
  });

  it("編集者（承認できない）には出さない", async () => {
    mocks.accountAccess.mockResolvedValue(EDITOR_ACCESS);
    mocks.listPostDrafts.mockResolvedValue(listResponse({ items: [draft({ id: "d1" })] }));
    renderPage();
    await card("下書きの本文");
    expect(screen.queryByRole("button", { name: "メンションを付ける" })).not.toBeInTheDocument();
  });
});

describe("投稿済みのカード（T025・T032）", () => {
  it("状態：予定・済み・やめた・出せなかった", async () => {
    const user = userEvent.setup();
    mocks.detachMention.mockResolvedValue({ draft: draft() });
    mocks.listPostDrafts.mockResolvedValue(listResponse());
    mocks.listPublished.mockResolvedValue({
      items: [
        published({ id: "a", body: "予定の投稿", mention: pending({ dueAt: "2026-11-05T12:30:00.000Z" }) }),
        published({ id: "b", body: "済みの投稿", mention: pending({ state: "sent", sentAt: "2026-11-05T03:46:00.000Z", replyPermalink: "https://www.threads.com/@shop/post/r1" }) }),
        published({ id: "c", body: "やめた投稿", mention: pending({ state: "canceled" }) }),
        published({ id: "d", body: "失敗の投稿", mention: pending({ state: "failed", failureReason: "no_permission" }) }),
      ],
      nextCursor: null,
    });
    renderPage("/accounts/a1/stock?tab=published");
    const a = await card("予定の投稿");
    expect(within(a).getByText("11/5 21:30 に返信予定")).toBeInTheDocument();
    await user.click(within(a).getByRole("button", { name: "メンションをやめる" }));
    expect(mocks.detachMention).toHaveBeenCalledWith("a1", "a", undefined);
    const b = await card("済みの投稿");
    expect(within(b).getByText(/12:46 に返信済み/)).toBeInTheDocument();
    expect(within(b).getByRole("link", { name: "返信を開く" })).toHaveAttribute("href", "https://www.threads.com/@shop/post/r1");
    expect(within(await card("やめた投稿")).getByText(/メンションをやめました/)).toBeInTheDocument();
    expect(within(await card("失敗の投稿")).getByText("時間差でメンション：出せませんでした（返信の権限がありません）")).toBeInTheDocument();
  });

  it("メンションのない投稿に付ける：今からメンションする → 返信する。7日を過ぎた投稿には出さない", async () => {
    const user = userEvent.setup();
    mocks.listPostDrafts.mockResolvedValue(listResponse());
    mocks.listPublished.mockResolvedValue({
      items: [
        published({ id: "new", body: "新しい投稿" }),
        published({ id: "old", body: "古い投稿", publishedAt: new Date(Date.now() - 8 * 86_400_000).toISOString() }),
      ],
      nextCursor: null,
    });
    renderPage("/accounts/a1/stock?tab=published");
    expect(within(await card("古い投稿")).queryByRole("button", { name: "メンションを付ける" })).not.toBeInTheDocument();
    const li = await card("新しい投稿");
    await user.click(await within(li).findByRole("button", { name: "メンションを付ける" }));
    expect(mocks.attachMention).not.toHaveBeenCalled();
    const group = within(li).getByRole("group", { name: "時間差でメンション" });
    expect(within(group).getByText("今からメンションする")).toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "返信する" }));
    expect(mocks.attachMention).toHaveBeenCalledWith("a1", "new", {
      expectedVersion: 3,
      usernames: ["minato_place", "taro"],
      text: "シェアお願いします\n@minato_place @taro",
    });
  });
});
