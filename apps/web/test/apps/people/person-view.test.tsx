// 人の一覧の並べ方とまとめた表示・タグと来てくれそう度の絞り込み（specs/people/002-sales-list tasks.md T216・T218、spec US1・US4、FR-102・FR-103）。
// 並べ方は API（PUT /settings の personView）で覚え、開いたら GET /settings で戻す。ブラウザには置かない。
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeListItem, renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
const api = {
  persons: vi.fn(),
  facets: vi.fn(),
  events: vi.fn(),
  tags: vi.fn(),
  settings: vi.fn(),
  updateSettings: vi.fn(),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { PeopleListPage } = await import("@/apps/people/pages/PeopleListPage");
const { groupPersons, kanaRowOf } = await import("@/apps/people/components/person/person-groups");
const { personListSearch } = await import("@/apps/people/lib/api");

const ROUTES = [{ path: "/people/list", element: <PeopleListPage /> }];
const REGULAR = { id: "t1", name: "常連" };
const SPEAKER = { id: "t2", name: "登壇してくれそう" };

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.persons.mockResolvedValue({
    persons: [
      makeListItem({ id: "p1", displayName: "あきこ", tags: [REGULAR, SPEAKER], likelihood: 3, lastMetOn: "2026-11-25" }),
      makeListItem({ id: "p2", displayName: "カズマ", tags: [REGULAR], lastMetOn: "2026-10-11" }),
      makeListItem({ id: "p3", displayName: "山田", tags: [], lastMetOn: null }),
    ],
    total: 3,
  });
  api.facets.mockResolvedValue({ nextAttendance: [], wantedConnections: [], careerInterests: [] });
  api.events.mockResolvedValue([]);
  api.tags.mockResolvedValue([
    { ...REGULAR, personCount: 2 },
    { ...SPEAKER, personCount: 1 },
  ]);
  api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: null, personView: { sort: "kana", group: "none" } });
  api.updateSettings.mockImplementation(async (input: object) => ({ inviteTemplate: null, repeaterGoal: null, personView: { sort: "kana", group: "none" }, ...input }));
});
afterEach(() => localStorage.clear());

describe("並べ方とまとめた表示", () => {
  it("開いたら、APIで覚えた並べ方で読む（覚えた値がわかってから1回だけ読む）", async () => {
    renderRoutes(ROUTES, "/people/list");
    await waitFor(() => expect(screen.getByLabelText("並べ方")).toHaveValue("kana"));
    await screen.findByText("全 3人");
    expect(api.persons).toHaveBeenCalledTimes(1);
    expect(api.persons).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "kana" }));
  });

  it("並べ方とまとめ方を選ぶと、その順で読み、APIで覚える。ブラウザには置かない", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list");
    await screen.findByText("全 3人");
    await user.selectOptions(screen.getByLabelText("並べ方"), "likelihood");
    expect(api.updateSettings).toHaveBeenLastCalledWith({ personView: { sort: "likelihood", group: "none" } });
    await waitFor(() => expect(api.persons).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "likelihood" })));
    await user.selectOptions(screen.getByLabelText("まとめ方"), "tag");
    expect(api.updateSettings).toHaveBeenLastCalledWith({ personView: { sort: "likelihood", group: "tag" } });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("タグごとにまとめると、複数のタグを持つ人は各まとまりに出る。タグなしは最後", async () => {
    api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: null, personView: { sort: "last_met", group: "tag" } });
    renderRoutes(ROUTES, "/people/list");
    const regular = await screen.findByRole("region", { name: "#常連" });
    expect(within(regular).getAllByRole("link").map((l) => l.textContent)).toEqual([expect.stringContaining("あきこ"), expect.stringContaining("カズマ")]);
    expect(within(regular).getByText("2人")).toBeInTheDocument();
    const speaker = screen.getByRole("region", { name: "#登壇してくれそう" });
    expect(within(speaker).getByRole("link", { name: /あきこ/ })).toBeInTheDocument();
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regions.at(-1)).toBe("タグなし");
  });

  it("年月ごと（最後に会った日。新しい月から。会っていない人は最後）・あいうえおの行ごとにまとめる", async () => {
    const user = userEvent.setup();
    api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: null, personView: { sort: "last_met", group: "month" } });
    renderRoutes(ROUTES, "/people/list");
    await screen.findByRole("region", { name: "2026年11月" });
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["2026年11月", "2026年10月", "会ったイベントなし"]);
    await user.selectOptions(screen.getByLabelText("まとめ方"), "kana");
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["あ行", "か行", "そのほか（漢字など）"]);
  });

  it("行にタグ・来てくれそう度・次にやることの印を出す", async () => {
    api.persons.mockResolvedValue({
      persons: [makeListItem({ tags: [REGULAR], likelihood: 2, nextAction: { on: "2000-01-01", note: "お礼を送る" } })],
      total: 1,
    });
    renderRoutes(ROUTES, "/people/list");
    const row = (await screen.findByRole("link", { name: /山田はなこ/ })).closest("li")!;
    expect(row).toHaveTextContent("#常連");
    expect(row).toHaveTextContent("来てくれそう：中");
    expect(within(row).getByText(/次：2000年1月1日：お礼を送る/).className).toContain("destructive");
  });
});

describe("タグと来てくれそう度の絞り込み", () => {
  it("タグ（どれかを持つ）と来てくれそう度で絞る", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list");
    await screen.findByText("全 3人");
    await user.click(screen.getByRole("button", { name: /絞り込み/ }));
    await user.click(screen.getByRole("button", { name: "#常連" }));
    await waitFor(() => expect(api.persons).toHaveBeenLastCalledWith(expect.objectContaining({ tag: ["t1"] })));
    await user.click(screen.getByRole("button", { name: "高" }));
    await user.click(screen.getByRole("button", { name: "なし" }));
    await waitFor(() => expect(api.persons).toHaveBeenLastCalledWith(expect.objectContaining({ tag: ["t1"], likelihood: ["3", "none"] })));
  });

  it("クエリにタグ・来てくれそう度をくり返し、並べ方を足す", () => {
    expect(personListSearch({ tag: ["t1", "t2"], likelihood: ["3", "none"], sort: "kana" })).toBe("?tag=t1&tag=t2&likelihood=3&likelihood=none&sort=kana");
  });
});

describe("まとめ方の部品", () => {
  it("あいうえおの行：カタカナはひらがなと同じ行、英字は A〜Z、漢字はそのほか", () => {
    expect(kanaRowOf("あきこ")).toBe("あ行");
    expect(kanaRowOf("カズマ")).toBe("か行");
    expect(kanaRowOf("ﾀﾛｳ")).toBe("た行");
    expect(kanaRowOf("ゆうき")).toBe("や行");
    expect(kanaRowOf("んな")).toBe("わ行");
    expect(kanaRowOf("Ken")).toBe("A〜Z");
    expect(kanaRowOf("山田")).toBe("そのほか（漢字など）");
  });

  it("まとめないときは1つのまとまり", () => {
    const p = makeListItem();
    expect(groupPersons([p], "none")).toEqual([{ key: "all", label: null, persons: [p] }]);
  });
});
