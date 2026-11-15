// Threads のイベントから選んで作る（specs/collect/001-event-day-collection User Story 6、FR-062〜FR-064、tasks.md T074）。
import type { ThreadsCandidate } from "@meguru/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ threadsCandidates: vi.fn(), createEvent: vi.fn() }));
vi.mock("@/apps/collect/lib/api", () => ({ collectApi: mocks }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const { EventNewPage } = await import("@/apps/collect/pages/EventNewPage");
const { SourceNotice } = await import("@/apps/collect/pages/RosterPage");
const { mediaOptionsFor } = await import("@/apps/collect/components/roster/QuickAdd");

const candidate = (over: Partial<ThreadsCandidate> = {}): ThreadsCandidate => ({
  promotionId: "p1",
  name: "IT交流会 ゆるく繋がる飲み会",
  startsAt: "2026-11-25T10:00:00.000Z",
  endsAt: "2026-11-25T13:00:00.000Z",
  venue: "バー SHITEN",
  capacity: 25,
  feeAmount: 5000,
  feeNote: "学生は3,000円",
  postedMedia: ["peatix"],
  usedByEventId: null,
  ...over,
});

/**
 * イベントを作る画面を描く。
 */
function renderNew() {
  const router = createMemoryRouter(
    [
      { path: "/collect/events/new", element: <EventNewPage /> },
      { path: "/collect/events/:eventId/roster", element: <p>名簿の画面</p> },
    ],
    { initialEntries: ["/collect/events/new"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("Threadsのイベントから選ぶ", () => {
  it("選ぶと名前・日時・会場・定員と区分の下書きが入り、作るときに元の番号を送る", async () => {
    mocks.threadsCandidates.mockResolvedValue({ candidates: [candidate()] });
    mocks.createEvent.mockResolvedValue({ id: "e9" });
    const user = userEvent.setup();
    renderNew();
    const row = await screen.findByRole("listitem", { name: "IT交流会 ゆるく繋がる飲み会" });
    expect(row).toHaveTextContent("掲載済み：Peatix");
    // 選ぶまではイベントはできない
    expect(mocks.createEvent).not.toHaveBeenCalled();
    await user.click(within(row).getByRole("button", { name: "これで作る" }));
    expect(screen.getByRole("status")).toHaveTextContent("参加費のメモ：学生は3,000円");
    expect(screen.getByDisplayValue("IT交流会 ゆるく繋がる飲み会")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-11-25")).toBeInTheDocument();
    expect(screen.getByDisplayValue("19:00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("22:00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("バー SHITEN")).toBeInTheDocument();
    expect(screen.getByDisplayValue("25")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "作る" }));
    await waitFor(() => expect(mocks.createEvent).toHaveBeenCalledTimes(1));
    expect(mocks.createEvent.mock.calls[0]![0]).toMatchObject({
      name: "IT交流会 ゆるく繋がる飲み会",
      venue: "バー SHITEN",
      capacity: 25,
      tiers: [{ name: "通常", amount: 5000 }],
      sourceThreadsPromotionId: "p1",
    });
    expect(await screen.findByText("名簿の画面")).toBeInTheDocument();
  });

  it("候補がなければ欄を出さない。作ったことのある候補は「作ったイベントを開く」", async () => {
    mocks.threadsCandidates.mockResolvedValue({ candidates: [] });
    renderNew();
    await waitFor(() => expect(mocks.threadsCandidates).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Threadsのイベントから選ぶ" })).toBeNull();
  });

  it("作ったことのある候補は、作ったイベントへ案内する", async () => {
    mocks.threadsCandidates.mockResolvedValue({ candidates: [candidate({ usedByEventId: "e1" })] });
    renderNew();
    const row = await screen.findByRole("listitem", { name: "IT交流会 ゆるく繋がる飲み会" });
    expect(within(row).getByRole("link", { name: "作ったイベントを開く" })).toHaveAttribute("href", "/collect/events/e1/roster");
  });
});

describe("名簿の媒体と元の知らせ", () => {
  it("掲載済みの媒体を先に並べ、印を付ける", () => {
    const labels = mediaOptionsFor(["peatix", "kokuchpro"]).map((o) => o.label);
    expect(labels.slice(0, 2)).toEqual(["こくちーずプロ（掲載済み）", "Peatix（掲載済み）"]);
    expect(labels).toHaveLength(8);
    expect(mediaOptionsFor([]).map((o) => o.label)[0]).toBe("港");
  });

  it("元が直された・消されたら知らせる", () => {
    const { rerender } = render(<SourceNotice sourceChangedAt="2026-11-20T01:00:00.000Z" sourceDeletedAt={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("元の Threads の宣伝内容が直されました");
    rerender(<SourceNotice sourceChangedAt="2026-11-20T01:00:00.000Z" sourceDeletedAt="2026-11-21T01:00:00.000Z" />);
    expect(screen.getByRole("status")).toHaveTextContent("消されました");
    rerender(<SourceNotice sourceChangedAt={null} sourceDeletedAt={null} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
