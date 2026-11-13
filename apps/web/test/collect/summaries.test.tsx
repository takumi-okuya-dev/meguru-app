// イベントを消す・まとめの画面（specs/collect/001-event-day-collection FR-011・FR-014、tasks.md T072）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ summaries: vi.fn(), deleteSummary: vi.fn(), event: vi.fn(), deleteEvent: vi.fn(), updateEvent: vi.fn() }));
vi.mock("@/apps/collect/lib/api", () => ({ collectApi: mocks }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const { SummariesPage } = await import("@/apps/collect/pages/SummariesPage");
const { EventEditPage } = await import("@/apps/collect/pages/EventEditPage");
const zero = { count: 0, amount: 0 };

/**
 * 画面を描く。
 * @param path - 開くURL
 */
function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/collect", element: <p>イベントの一覧</p> },
      { path: "/collect/summaries", element: <SummariesPage /> },
      { path: "/collect/events/:eventId/edit", element: <EventEditPage /> },
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
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.summaries.mockResolvedValue({
    summaries: [
      {
        id: "s1",
        name: "10月の会",
        startsAt: "2026-10-10T10:00:00.000Z",
        rosterCount: 20,
        attendedCount: 18,
        byMethod: { cash: { count: 10, amount: 30000 }, paypay: { count: 5, amount: 15000 }, transfer_today: zero, transfer_later: { count: 2, amount: 6000 }, none: { count: 1, amount: 0 } },
        byMedia: [{ media: "peatix", roster: 12, attended: 11, paid: 33000, awaiting: 3000 }],
        awaitingTransfer: { count: 1, amount: 3000 },
        eventDeletedAt: "2026-10-20T00:00:00.000Z",
      },
    ],
  });
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
});

describe("まとめ", () => {
  it("数字の一覧を出し、確かめてから消す", async () => {
    mocks.deleteSummary.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderAt("/collect/summaries");
    const row = await screen.findByRole("listitem", { name: "10月の会" });
    expect(row).toHaveTextContent("来場 18 / 20人・現金 30,000円・PayPay 15,000円・振込 6,000円（うち振込待ち 1件・3,000円）");
    // 内訳：払い方ごとの件数と合計・媒体ごと（FR-014）
    await user.click(within(row).getByText("内訳を見る"));
    const methods = within(row).getByRole("table", { name: "10月の会の払い方ごと" });
    expect(within(methods).getByRole("row", { name: /現金 10件 30,000円/ })).toBeInTheDocument();
    const media = within(row).getByRole("table", { name: "10月の会の媒体ごと" });
    expect(within(media).getByRole("row", { name: /Peatix 12人 11人 33,000円 3,000円/ })).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "消す" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "消す" }));
    await waitFor(() => expect(mocks.deleteSummary).toHaveBeenCalledWith("s1"));
  });
});

describe("イベントを消す", () => {
  it("名簿と記録が消え、数字だけが残ることを確かめてから消し、一覧へ戻る", async () => {
    mocks.deleteEvent.mockResolvedValue({ summaryId: "s2" });
    const user = userEvent.setup();
    renderAt("/collect/events/e1/edit");
    await user.click(await screen.findByRole("button", { name: "イベントを消す" }));
    const dialog = await screen.findByRole("dialog", { name: "イベントを消しますか？" });
    expect(dialog).toHaveTextContent("数字のまとめだけが残ります");
    await user.click(within(dialog).getByRole("button", { name: "消す" }));
    await waitFor(() => expect(mocks.deleteEvent).toHaveBeenCalledWith("e1"));
    expect(await screen.findByText("イベントの一覧")).toBeInTheDocument();
  });
});
