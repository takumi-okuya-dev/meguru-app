// 集金管理の骨格（specs/collect/001-event-day-collection contracts/ui-routes.md 1、tasks.md T018・T019）。
// 利用の許可のない人には「使えない」の案内だけを出す。ある人には、サイドバー（イベント・作る・振込待ち・まとめ・このアプリの設定）を出す。
// イベントを開いているときは、そのイベントの画面を画面の下のタブバーで切り替える（サイドバーには出さない）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "../helpers/billing";

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({ user: null }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

const mocks = vi.hoisted(() => ({ me: vi.fn(), events: vi.fn(), collectMe: vi.fn(), event: vi.fn(), roster: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, me: mocks.me, putLastApp: vi.fn().mockResolvedValue(undefined) } };
});
vi.mock("@/apps/collect/lib/api", () => ({
  collectApi: { events: mocks.events, me: mocks.collectMe, event: mocks.event, roster: mocks.roster, pastAttendees: vi.fn().mockResolvedValue({ candidates: [] }) },
}));

const { collectApp } = await import("@/apps/collect");
const { AppRegistryProvider } = await import("@/shell");

/**
 * 集金管理のルートを描く。
 * @param path - 開くURL
 */
function renderAt(path: string) {
  const router = createMemoryRouter(collectApp.routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppRegistryProvider value={[collectApp]}>
        <RouterProvider router={router} />
      </AppRegistryProvider>
    </QueryClientProvider>,
  );
}

const meWith = (available: string[]) => ({ ...ME_BILLING_OFF, user: { id: "u1", email: "a@example.com", displayName: null }, apps: { available, using: [], last: null, landing: null } });

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.events.mockResolvedValue({ events: [] });
  mocks.collectMe.mockResolvedValue({ hasPaypayQr: true, hasBankText: true, awaitingTransferCount: 0 });
});

describe("集金管理の骨格", () => {
  it("利用の許可のない人には、使えないことだけを出し、集金管理の画面を読まない", async () => {
    mocks.me.mockResolvedValue(meWith(["threads"]));
    renderAt("/collect");
    expect(await screen.findByRole("heading", { name: "このアプリは今は使えません" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "すべてのアプリへ" })).toHaveAttribute("href", "/apps");
    expect(mocks.events).not.toHaveBeenCalled();
  });

  it("許可のある人には、サイドバーとイベントの一覧を出す（イベントを開いていなければ、イベントの項目は出さない）", async () => {
    mocks.me.mockResolvedValue(meWith(["threads", "collect"]));
    renderAt("/collect");
    expect(await screen.findByText("まだイベントがありません")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "集金管理" });
    expect(within(nav).getByRole("link", { name: "イベント" })).toHaveAttribute("href", "/collect");
    expect(within(nav).getByRole("link", { name: "イベントを作る" })).toHaveAttribute("href", "/collect/events/new");
    expect(within(nav).getByRole("link", { name: /振込待ち/ })).toHaveAttribute("href", "/collect/transfers");
    expect(within(nav).getByRole("link", { name: "まとめ" })).toHaveAttribute("href", "/collect/summaries");
    expect(within(nav).queryByRole("link", { name: "名簿" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /受付|締め/ })).toBeNull();
    expect(screen.getByRole("link", { name: "このアプリの設定" })).toHaveAttribute("href", "/collect/settings");
    expect(screen.queryByRole("navigation", { name: "このイベント" })).toBeNull();
  });

  it("イベントを開いているときは、画面の下のタブバーでそのイベントの画面を切り替え、サイドバーには出さない（「イベント」を選んだ状態）", async () => {
    mocks.me.mockResolvedValue(meWith(["collect"]));
    mocks.event.mockResolvedValue({
      id: "e1",
      name: "IT交流会",
      startsAt: "2026-11-20T10:00:00.000Z",
      endsAt: null,
      venue: null,
      capacity: null,
      methods: ["cash"],
      tiers: [{ id: "t1", name: "通常", amount: 3000, position: 0 }],
      closedAt: null,
      sourceThreadsPromotionId: null,
      sourceChangedAt: null,
      sourceDeletedAt: null,
      version: 0,
      createdAt: "2026-11-13T00:00:00.000Z",
      updatedAt: "2026-11-13T00:00:00.000Z",
    });
    mocks.roster.mockResolvedValue({ people: [], version: 0 });
    renderAt("/collect/events/e1/roster");
    const tabs = await screen.findByRole("navigation", { name: "このイベント" });
    const expected: [string, string][] = [
      ["名簿", "/collect/events/e1/roster"],
      ["受付", "/collect/events/e1/reception"],
      ["受付の手伝い", "/collect/events/e1/helpers"],
      ["セルフ受付", "/collect/events/e1/self"],
      ["締め", "/collect/events/e1/closing"],
      ["分配", "/collect/events/e1/sharing"],
    ];
    expect(within(tabs).getAllByRole("link").map((a) => [a.getAttribute("aria-label") ?? a.textContent, a.getAttribute("href")])).toEqual(expected);
    expect(within(tabs).getByRole("link", { name: "名簿" })).toHaveAttribute("aria-current", "page");
    const nav = screen.getByRole("navigation", { name: "集金管理" });
    expect(within(nav).queryByRole("link", { name: "名簿" })).toBeNull();
    expect(within(nav).queryByText("IT交流会")).toBeNull();
    expect(within(nav).getByRole("link", { name: "イベント" })).toHaveClass("bg-accent");
  });
});
