// リピーターの目標と会の数字（specs/people/001-people-memo tasks.md T086、spec US5、research.md R12）。
// 誘う候補の上の段（「リピーター n人／目標 n人」、目標がなければ「目標を決める」）と、自分の会のページの数字（参加者・初めて・前にも来た・消した人）。
import type { PeopleEventDetail } from "@meguru/shared/people";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_1125, EVENT_1213, makeCandidate, renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = {
  home: vi.fn(),
  tags: vi.fn(),
  candidates: vi.fn(),
  stats: vi.fn(),
  settings: vi.fn(),
  events: vi.fn(),
  facets: vi.fn(),
  event: vi.fn(),
  attendees: vi.fn(),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { CandidatesPage } = await import("@/apps/people/pages/CandidatesPage");
const { EventPage } = await import("@/apps/people/pages/EventPage");

const ROUTES = [
  { path: "/people", element: <CandidatesPage /> },
  { path: "/people/events/:eventId", element: <EventPage /> },
];

/** 11/25の自分の会（初めて6人・前にも来た4人・消した人1人）。 */
const OWN_DETAIL: PeopleEventDetail = {
  event: { id: "e2", name: "11月の交流会", heldOn: "2026-11-25", isOwn: true },
  stats: { attendeeCount: 10, erasedCount: 1, firstTimeCount: 6, returningCount: 4 },
  imports: [],
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.home.mockResolvedValue({ today: [], overdue: [], birthdays: [] });
  api.tags.mockResolvedValue([]);
  api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: null });
  api.events.mockResolvedValue([EVENT_1213]);
  api.facets.mockResolvedValue({ nextAttendance: [], wantedConnections: [], careerInterests: [] });
  api.candidates.mockResolvedValue({ persons: [makeCandidate()], total: 1 });
  api.attendees.mockResolvedValue([
    { personId: "p1", displayName: "山田はなこ", lineName: "はな", via: "response", firstTime: false },
    { personId: "p2", displayName: "たろう", lineName: "たろう", via: "response", firstTime: true },
  ]);
});

describe("リピーターの段", () => {
  it("目標を決めていれば「リピーター 4人／目標 10人」", async () => {
    api.stats.mockResolvedValue({ repeaterCount: 4, repeaterGoal: 10, nextOwnEvent: null });
    renderRoutes(ROUTES, "/people");
    const band = await screen.findByRole("region", { name: "リピーター" });
    expect(await within(band).findByText("リピーター 4人／目標 10人")).toBeInTheDocument();
    expect(within(band).queryByRole("link", { name: "目標を決める" })).not.toBeInTheDocument();
  });

  it("目標がなければ、今の数と「目標を決める」（設定へ）", async () => {
    api.stats.mockResolvedValue({ repeaterCount: 4, repeaterGoal: null, nextOwnEvent: null });
    renderRoutes(ROUTES, "/people");
    const band = await screen.findByRole("region", { name: "リピーター" });
    expect(await within(band).findByText("リピーター 4人")).toBeInTheDocument();
    expect(within(band).getByRole("link", { name: "目標を決める" })).toHaveAttribute("href", "/people/settings");
  });
});

describe("会のページの数字", () => {
  it("自分の会には、参加者・初めて・前にも来た・消した人を出し、来た人に「初めて」の印", async () => {
    api.event.mockResolvedValue(OWN_DETAIL);
    renderRoutes(ROUTES, "/people/events/e2");
    expect(await screen.findByText("参加者 10人")).toBeInTheDocument();
    expect(screen.getByText("初めて 6人")).toBeInTheDocument();
    expect(screen.getByText("前にも来た 4人")).toBeInTheDocument();
    expect(screen.getByText("消した人 1人")).toBeInTheDocument();
    const rows = await screen.findAllByRole("link", { name: /山田はなこ|たろう/ });
    expect(rows[0]).not.toHaveTextContent("初めて");
    expect(rows[1]).toHaveTextContent("初めて");
  });

  it("ほかの人の会（参加者として出た会）には、初めて・前にも来たを出さない", async () => {
    api.event.mockResolvedValue({
      event: { id: EVENT_1125.id, name: EVENT_1125.name, heldOn: EVENT_1125.heldOn, isOwn: false },
      stats: { attendeeCount: 2, erasedCount: 0 },
      imports: [],
    });
    api.attendees.mockResolvedValue([{ personId: "p1", displayName: "山田はなこ", lineName: "はな", via: "response" }]);
    renderRoutes(ROUTES, "/people/events/e2");
    expect(await screen.findByText("参加者 2人")).toBeInTheDocument();
    expect(screen.queryByText(/初めて/)).not.toBeInTheDocument();
    expect(screen.queryByText(/前にも来た/)).not.toBeInTheDocument();
  });
});
