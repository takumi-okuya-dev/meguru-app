// 会ごとの声かけの一覧（specs/people/002-sales-list tasks.md T216・T220、spec US5、FR-108・SC-102）。
import type { OutreachBoard, PeopleEventDetail } from "@meguru/shared/people";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_1213, makeListItem, makeOutreach, renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = { outreachBoard: vi.fn(), updateOutreach: vi.fn(), deleteOutreach: vi.fn(), event: vi.fn(), attendees: vi.fn() };
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { OutreachBoardPage } = await import("@/apps/people/pages/OutreachBoardPage");
const { EventPage } = await import("@/apps/people/pages/EventPage");

const ROUTES = [
  { path: "/people/events/:eventId", element: <EventPage /> },
  { path: "/people/events/:eventId/outreach", element: <OutreachBoardPage /> },
];
const EVENT = { id: EVENT_1213.id, name: EVENT_1213.name, heldOn: EVENT_1213.heldOn, isOwn: true };

/**
 * 一覧の1行を作る。
 * @param id - 人のID
 * @param name - 名前
 * @param stage - 進み具合
 * @returns 1行
 */
function row(id: string, name: string, stage: "asked" | "link_sent" | "attended") {
  return { ...makeListItem({ id, displayName: name, likelihood: 3, nextAction: { on: "2026-11-20", note: "リンクを送る" } }), outreach: makeOutreach({ id: `o-${id}`, personId: id, stage }) };
}

const BOARD: OutreachBoard = {
  event: EVENT,
  stages: { asked: [row("a", "あきこ", "asked"), row("b", "ぶんた", "asked")], link_sent: [row("c", "ちえ", "link_sent")], attended: [] },
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.outreachBoard.mockResolvedValue(BOARD);
  api.updateOutreach.mockResolvedValue(makeOutreach({ stage: "link_sent" }));
  api.attendees.mockResolvedValue([]);
});

describe("会ごとの声かけの一覧", () => {
  it("興味を聞いた・参加リンクを送った・来たの順に、人数と人（名前・最後に会った日・来てくれそう度・次にやること）を出す", async () => {
    renderRoutes(ROUTES, "/people/events/e3/outreach");
    const asked = await screen.findByRole("region", { name: "興味を聞いた" });
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["興味を聞いた", "参加リンクを送った", "来た"]);
    expect(within(asked).getByText("2人")).toBeInTheDocument();
    const a = within(asked).getAllByRole("listitem")[0]!;
    expect(a).toHaveTextContent("あきこ");
    expect(a).toHaveTextContent("最後に会った日 2026年10月11日");
    expect(a).toHaveTextContent("来てくれそう：高");
    expect(a).toHaveTextContent("次：2026年11月20日：リンクを送る");
    expect(within(a).getByRole("link", { name: /あきこ/ })).toHaveAttribute("href", "/people/list/a");
    expect(within(screen.getByRole("region", { name: "来た" })).getByText("いません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /IT交流会 12\/13/ })).toHaveAttribute("href", "/people/events/e3");
  });

  it("行から進み具合を変える", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/events/e3/outreach");
    const group = await screen.findByRole("group", { name: "進み具合：あきこ" });
    await user.click(within(group).getByRole("button", { name: "参加リンクを送った" }));
    expect(api.updateOutreach).toHaveBeenCalledWith("o-a", "link_sent");
  });

  it("自分の会ではないと（400）、自分の会だけで見られると出す", async () => {
    const { ApiError } = await import("@/lib/api-client");
    api.outreachBoard.mockRejectedValue(new ApiError("VALIDATION_FAILED", 400));
    renderRoutes(ROUTES, "/people/events/e2/outreach");
    expect(await screen.findByText("声かけの一覧は、自分の会だけで見られます")).toBeInTheDocument();
  });
});

describe("イベントのページから開く", () => {
  it("自分の会には「声かけの一覧」を出し、ほかの人の会には出さない", async () => {
    const own: PeopleEventDetail = { event: EVENT, stats: { attendeeCount: 0, erasedCount: 0, firstTimeCount: 0, returningCount: 0 }, imports: [] };
    api.event.mockResolvedValue(own);
    const { unmount } = await import("@testing-library/react").then(({ cleanup }) => ({ unmount: cleanup }));
    renderRoutes(ROUTES, "/people/events/e3");
    expect(await screen.findByRole("link", { name: /声かけの一覧/ })).toHaveAttribute("href", "/people/events/e3/outreach");
    unmount();
    api.event.mockResolvedValue({ ...own, event: { ...EVENT, isOwn: false } });
    renderRoutes(ROUTES, "/people/events/e3");
    await screen.findByText("参加者 0人");
    expect(screen.queryByRole("link", { name: /声かけの一覧/ })).not.toBeInTheDocument();
  });
});
