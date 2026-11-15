// タグ：人のページで付ける・外す・新しい名前で作る、誘う候補で絞る、設定で名前を直す・消す（specs/people/002-sales-list tasks.md T216、spec US1、FR-101・FR-102）。
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_1213, makeCandidate, makeDetail, makeSummary, renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
const api = {
  person: vi.fn(),
  tags: vi.fn(),
  setPersonTags: vi.fn(),
  renameTag: vi.fn(),
  deleteTag: vi.fn(),
  settings: vi.fn(),
  fields: vi.fn(),
  home: vi.fn(),
  candidates: vi.fn(),
  stats: vi.fn(),
  events: vi.fn(),
  facets: vi.fn(),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { PersonPage } = await import("@/apps/people/pages/PersonPage");
const { SettingsPage } = await import("@/apps/people/pages/SettingsPage");
const { CandidatesPage } = await import("@/apps/people/pages/CandidatesPage");
const { ApiError } = await import("@/lib/api-client");

const ROUTES = [
  { path: "/people", element: <CandidatesPage /> },
  { path: "/people/list/:personId", element: <PersonPage /> },
  { path: "/people/settings", element: <SettingsPage /> },
];
const REGULAR = { id: "t1", name: "常連" };
const SPEAKER = { id: "t2", name: "登壇してくれそう" };

/**
 * 人のページのタグの段を返す。
 * @returns 段
 */
async function tagSection() {
  return (await screen.findByRole("heading", { name: "タグ" })).closest("section")!;
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.person.mockResolvedValue(makeDetail({ person: makeSummary({ tags: [REGULAR] }) }));
  api.tags.mockResolvedValue([
    { ...REGULAR, personCount: 3 },
    { ...SPEAKER, personCount: 1 },
  ]);
  api.setPersonTags.mockResolvedValue([REGULAR]);
  api.renameTag.mockResolvedValue({ ...REGULAR, personCount: 3 });
  api.deleteTag.mockResolvedValue(null);
  api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: null, personView: { sort: "last_met", group: "none" } });
  api.fields.mockResolvedValue([]);
  api.home.mockResolvedValue({ today: [], overdue: [], birthdays: [] });
  api.candidates.mockResolvedValue({ persons: [makeCandidate()], total: 1 });
  api.stats.mockResolvedValue({ repeaterCount: 0, repeaterGoal: null, nextOwnEvent: null });
  api.events.mockResolvedValue([EVENT_1213]);
  api.facets.mockResolvedValue({ nextAttendance: [], wantedConnections: [], careerInterests: [] });
});

describe("人のページのタグ", () => {
  it("付いているタグを出し、外せる", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list/p1");
    const section = await tagSection();
    expect(within(section).getByRole("list", { name: "付いているタグ" })).toHaveTextContent("#常連");
    await user.click(within(section).getByRole("button", { name: "「常連」を外す" }));
    expect(api.setPersonTags).toHaveBeenCalledWith("p1", { tagIds: [], newTagNames: [] });
  });

  it("新しい名前で作って付ける。もうある名前（全角・半角や大文字の違いも）はそのタグを付ける", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list/p1");
    const section = await tagSection();
    const box = within(section).getByLabelText("タグを付ける");
    await user.type(box, " 港の相談 ");
    await user.click(within(section).getByRole("button", { name: /付ける/ }));
    expect(api.setPersonTags).toHaveBeenLastCalledWith("p1", { tagIds: ["t1"], newTagNames: ["港の相談"] });
    await waitFor(() => expect(box).toHaveValue(""));
    await user.type(box, "登壇してくれそう");
    await user.click(within(section).getByRole("button", { name: /付ける/ }));
    expect(api.setPersonTags).toHaveBeenLastCalledWith("p1", { tagIds: ["t1", "t2"], newTagNames: [] });
  });

  it("付けられるタグを押して付ける（付いているものは出さない）", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list/p1");
    const section = await tagSection();
    const group = await within(section).findByRole("group", { name: "付けられるタグ" });
    expect(within(group).queryByRole("button", { name: /常連/ })).not.toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "＋#登壇してくれそう" }));
    expect(api.setPersonTags).toHaveBeenCalledWith("p1", { tagIds: ["t1", "t2"], newTagNames: [] });
  });

  it("30文字を超える名前は付けられない", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list/p1");
    const section = await tagSection();
    await user.type(within(section).getByLabelText("タグを付ける"), "あ".repeat(31));
    expect(within(section).getByText("タグの名前は30文字までです。")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: /付ける/ })).toBeDisabled();
  });
});

describe("誘う候補のタグと来てくれそう度", () => {
  it("タグ・来てくれそう度で絞り、来てくれそう度の順にも並べられる（同意の絞り込みはAPIのまま）", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people");
    await screen.findByText("山田はなこ");
    await user.click(screen.getByRole("button", { name: /絞り込み/ }));
    await user.click(screen.getByRole("button", { name: "#登壇してくれそう" }));
    await user.click(screen.getByRole("button", { name: "高" }));
    await waitFor(() => expect(api.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: "invite", tag: ["t2"], likelihood: ["3"] })));
    await user.selectOptions(screen.getByLabelText("並べ方"), "likelihood");
    await waitFor(() => expect(api.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "likelihood", tag: ["t2"] })));
  });
});

describe("設定のタグ", () => {
  it("タグの一覧（人数つき）を出し、名前を直す", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/settings");
    const list = await screen.findByRole("list", { name: "タグの一覧" });
    expect(list).toHaveTextContent("#常連");
    expect(list).toHaveTextContent("3人");
    await user.click(within(list).getByRole("button", { name: "「常連」の名前を直す" }));
    const box = within(list).getByLabelText("「常連」の新しい名前");
    await user.clear(box);
    await user.type(box, "いつもの人");
    await user.click(within(list).getByRole("button", { name: "保存" }));
    expect(api.renameTag).toHaveBeenCalledWith("t1", "いつもの人");
  });

  it("同じ名前がもうあるときは（409 PEOPLE_NAME_TAKEN）「同じ名前がもうあります。」", async () => {
    const user = userEvent.setup();
    api.renameTag.mockRejectedValue(new ApiError("PEOPLE_NAME_TAKEN", 409));
    renderRoutes(ROUTES, "/people/settings");
    const list = await screen.findByRole("list", { name: "タグの一覧" });
    await user.click(within(list).getByRole("button", { name: "「常連」の名前を直す" }));
    const box = within(list).getByLabelText("「常連」の新しい名前");
    await user.clear(box);
    await user.type(box, "登壇してくれそう");
    await user.click(within(list).getByRole("button", { name: "保存" }));
    expect(await within(list).findByRole("alert")).toHaveTextContent("同じ名前がもうあります。");
  });

  it("消すときは、付けていた人数を出して確かめる", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/settings");
    const list = await screen.findByRole("list", { name: "タグの一覧" });
    await user.click(within(list).getByRole("button", { name: "「常連」を消す" }));
    const confirm = within(list).getByRole("group", { name: "「常連」を消す確かめ" });
    expect(confirm).toHaveTextContent("付けていた3人から外れます");
    await user.click(within(confirm).getByRole("button", { name: "タグを消す" }));
    expect(api.deleteTag).toHaveBeenCalledWith("t1");
  });
});
