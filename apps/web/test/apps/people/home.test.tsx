// ホームの「今日やること・過ぎたもの・近い誕生日」（specs/people/002-sales-list tasks.md T216・T217、spec US2、FR-104）。
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_1213, makeCandidate, makeListItem, renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = {
  home: vi.fn(),
  tags: vi.fn(),
  candidates: vi.fn(),
  stats: vi.fn(),
  settings: vi.fn(),
  events: vi.fn(),
  facets: vi.fn(),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { CandidatesPage } = await import("@/apps/people/pages/CandidatesPage");

const ROUTES = [{ path: "/people", element: <CandidatesPage /> }];

/**
 * ホームの1行を作る。
 * @param id - 人のID
 * @param name - 名前
 * @param over - 上書き
 * @returns 1行
 */
function item(id: string, name: string, over: Partial<ReturnType<typeof makeListItem> & { birthdayMd: string | null }> = {}) {
  return { ...makeListItem({ id, displayName: name, realName: name }), birthdayMd: null, ...over };
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.tags.mockResolvedValue([]);
  api.candidates.mockResolvedValue({ persons: [makeCandidate()], total: 1 });
  api.stats.mockResolvedValue({ repeaterCount: 0, repeaterGoal: null, nextOwnEvent: null });
  api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: null, personView: { sort: "last_met", group: "none" } });
  api.events.mockResolvedValue([EVENT_1213]);
  api.facets.mockResolvedValue({ nextAttendance: [], wantedConnections: [], careerInterests: [] });
});

describe("ホーム", () => {
  it("今日やること・過ぎたもの・近い誕生日を出し、行から人のページへ。過ぎたものは目立たせる", async () => {
    api.home.mockResolvedValue({
      today: [item("a", "あきこ", { nextAction: { on: "2026-11-13", note: "12月の会の案内を送る" } })],
      overdue: [item("b", "ぶんた", { nextAction: { on: "2026-11-12", note: "お礼を送る" } })],
      birthdays: [item("c", "ちえ", { birthdayMd: "11-15" })],
    });
    renderRoutes(ROUTES, "/people");
    const today = await screen.findByRole("region", { name: "今日やること" });
    expect(within(today).getByText("1人")).toBeInTheDocument();
    const a = within(today).getByRole("link", { name: /あきこ/ });
    expect(a).toHaveAttribute("href", "/people/list/a");
    expect(a).toHaveTextContent("2026年11月13日：12月の会の案内を送る");

    const overdue = screen.getByRole("region", { name: "過ぎたもの" });
    expect(overdue.className).toContain("destructive");
    expect(within(overdue).getByRole("link", { name: /ぶんた/ })).toHaveTextContent("お礼を送る");

    const birthdays = screen.getByRole("region", { name: "近い誕生日" });
    expect(within(birthdays).getByRole("link", { name: /ちえ/ })).toHaveTextContent("誕生日 11月15日");
  });

  it("今日やることがなければ、決め方を出す。過ぎたもの・誕生日がなければ、そのまとまりは出さない", async () => {
    api.home.mockResolvedValue({ today: [], overdue: [], birthdays: [] });
    renderRoutes(ROUTES, "/people");
    expect(await screen.findByText(/今日やることはありません/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "過ぎたもの" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "近い誕生日" })).not.toBeInTheDocument();
  });

  it("APIの上限（200人）に届いたまとまりには「ほかにもいます」と出す", async () => {
    api.home.mockResolvedValue({
      today: Array.from({ length: 200 }, (_, i) => item(`p${i}`, `人${i}`, { nextAction: { on: "2026-11-13", note: "連絡" } })),
      overdue: [item("b", "ぶんた", { nextAction: { on: "2026-11-12", note: "お礼" } })],
      birthdays: [],
    });
    renderRoutes(ROUTES, "/people");
    const today = await screen.findByRole("region", { name: "今日やること" });
    expect(within(today).getByText("ほかにもいます（最初の200人まで出しています）。")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "過ぎたもの" })).queryByText(/ほかにもいます/)).not.toBeInTheDocument();
  });

  it("6人以上いるときは5人まで出し、「すべて出す」で残りも出す", async () => {
    const user = userEvent.setup();
    api.home.mockResolvedValue({
      today: Array.from({ length: 7 }, (_, i) => item(`p${i}`, `人${i}`, { nextAction: { on: "2026-11-13", note: "連絡" } })),
      overdue: [],
      birthdays: [],
    });
    renderRoutes(ROUTES, "/people");
    const today = await screen.findByRole("region", { name: "今日やること" });
    expect(within(today).getAllByRole("link")).toHaveLength(5);
    await user.click(within(today).getByRole("button", { name: "すべて出す（7人）" }));
    expect(within(today).getAllByRole("link")).toHaveLength(7);
  });
});
