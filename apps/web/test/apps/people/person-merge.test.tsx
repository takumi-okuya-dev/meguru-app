// 人を足す・まとめる・分ける（specs/people/001-people-memo tasks.md T059、contracts/ui-routes.md 1、research.md R15、FR-014）。
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_1011, EVENT_1125, makeDetail, makeListItem, makeResponse, makeSummary, renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = {
  persons: vi.fn(),
  facets: vi.fn(),
  events: vi.fn(),
  person: vi.fn(),
  createPerson: vi.fn(),
  mergePerson: vi.fn(),
  splitResponse: vi.fn(),
  addAttendance: vi.fn(),
  removeAttendance: vi.fn(),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { PeopleListPage } = await import("@/apps/people/pages/PeopleListPage");
const { PersonNewPage } = await import("@/apps/people/pages/PersonNewPage");
const { PersonPage } = await import("@/apps/people/pages/PersonPage");

const ROUTES = [
  { path: "/people/list", element: <PeopleListPage /> },
  { path: "/people/list/new", element: <PersonNewPage /> },
  { path: "/people/list/:personId", element: <PersonPage /> },
];

/** 分けたあとの新しい人。 */
const SPLIT_PERSON = makeDetail({
  person: makeSummary({ id: "p9", displayName: "はなこ🌸", realName: null, lineName: "はなこ🌸", otherLineNames: [] }),
  attendances: [makeDetail().attendances[0]!],
  consentChanges: [],
});

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.events.mockResolvedValue([EVENT_1125, EVENT_1011]);
  api.facets.mockResolvedValue({ nextAttendance: [], wantedConnections: [], careerInterests: [] });
  api.persons.mockResolvedValue({ persons: [], total: 0 });
  api.person.mockImplementation(async (id: string) => (id === "p9" ? SPLIT_PERSON : makeDetail()));
});

describe("人を足す", () => {
  it("本名もLINE名もなければ足せない。入れて足すと、人のページへ移る（同意は初めは同意なし）", async () => {
    const user = userEvent.setup();
    api.createPerson.mockResolvedValue(makeSummary({ id: "p5" }));
    const router = renderRoutes(ROUTES, "/people/list/new");
    expect(screen.getByRole("checkbox", { name: /交流会への誘い/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /仕事の相談先へのつなぎ/ })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "足す" }));
    expect(screen.getByText("本名かLINE名を入れてください")).toBeInTheDocument();
    expect(api.createPerson).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("LINE名"), " はな ");
    await user.selectOptions(await screen.findByLabelText("会ったイベント"), "e1");
    await user.click(screen.getByRole("checkbox", { name: /交流会への誘い/ }));
    await user.click(screen.getByRole("button", { name: "足す" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/people/list/p5"));
    expect(api.createPerson).toHaveBeenCalledWith({ lineName: "はな", eventId: "e1", consent: { invite: true, work: false } });
  });

  it("イベントを選ばず、本名だけでも足せる", async () => {
    const user = userEvent.setup();
    api.createPerson.mockResolvedValue(makeSummary({ id: "p6" }));
    renderRoutes(ROUTES, "/people/list/new");
    await user.type(screen.getByLabelText("本名"), "鈴木一郎");
    await user.click(screen.getByRole("button", { name: "足す" }));
    await waitFor(() => expect(api.createPerson).toHaveBeenCalledWith({ realName: "鈴木一郎", consent: { invite: false, work: false } }));
  });
});

describe("この人と同じ人（まとめる）", () => {
  it("名前で探して選び、確かめてからまとめる。今の人のページにとどまる", async () => {
    const user = userEvent.setup();
    api.persons.mockResolvedValue({
      persons: [makeListItem(), makeListItem({ id: "p3", displayName: "はなこ", realName: null, lineName: "はなこ", lastMetOn: "2026-09-01" })],
      total: 2,
    });
    api.mergePerson.mockResolvedValue(makeSummary());
    const router = renderRoutes(ROUTES, "/people/list/p1");
    await user.click(await screen.findByRole("button", { name: /この人と同じ人/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("同じ人を名前で探す"), "はなこ");
    await waitFor(() => expect(api.persons).toHaveBeenLastCalledWith({ q: "はなこ", offset: 0 }));
    const found = await within(dialog).findByRole("list", { name: "見つかった人" });
    // 今の人は候補に出さない
    expect(within(found).getAllByRole("button")).toHaveLength(1);
    await user.click(within(found).getByRole("button", { name: /はなこ/ }));

    expect(within(dialog).getByRole("heading", { name: "同じ人としてまとめますか？" })).toBeInTheDocument();
    expect(within(dialog).getByText("「はなこ」を「山田はなこ」にまとめます。")).toBeInTheDocument();
    expect(within(dialog).getByText("「はなこ」は一覧からなくなります")).toBeInTheDocument();
    expect(api.mergePerson).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "まとめる" }));
    await waitFor(() => expect(api.mergePerson).toHaveBeenCalledWith("p1", "p3"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/people/list/p1");
  });

  it("100人を超えて当たったら「もっと見る」で続きを読み、101人目も選べる", async () => {
    const user = userEvent.setup();
    const page1 = Array.from({ length: 100 }, (_, i) => makeListItem({ id: `q${i}`, displayName: `はな${i}` }));
    api.persons.mockImplementation(async (params: { offset?: number }) =>
      params.offset ? { persons: [makeListItem({ id: "q100", displayName: "はな100" })], total: 101 } : { persons: page1, total: 101 },
    );
    renderRoutes(ROUTES, "/people/list/p1");
    await user.click(await screen.findByRole("button", { name: /この人と同じ人/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("同じ人を名前で探す"), "はな");
    await user.click(await within(dialog).findByRole("button", { name: "もっと見る" }));
    await waitFor(() => expect(api.persons).toHaveBeenLastCalledWith({ q: "はな", offset: 100 }));
    expect(await within(dialog).findByRole("button", { name: /はな100/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "もっと見る" })).not.toBeInTheDocument();
  });

  it("確かめの画面から「戻る」で選び直せる", async () => {
    const user = userEvent.setup();
    api.persons.mockResolvedValue({ persons: [makeListItem({ id: "p3", displayName: "はなこ" })], total: 1 });
    renderRoutes(ROUTES, "/people/list/p1");
    await user.click(await screen.findByRole("button", { name: /この人と同じ人/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("同じ人を名前で探す"), "はな");
    await user.click(await within(dialog).findByRole("button", { name: /はなこ/ }));
    await user.click(within(dialog).getByRole("button", { name: "戻る" }));
    expect(within(dialog).getByLabelText("同じ人を名前で探す")).toBeInTheDocument();
    expect(api.mergePerson).not.toHaveBeenCalled();
  });
});

describe("別の人に分ける", () => {
  it("回答ごとの「別の人に分ける」を確かめると、新しい人のページへ移る", async () => {
    const user = userEvent.setup();
    api.splitResponse.mockResolvedValue(SPLIT_PERSON.person);
    const router = renderRoutes(ROUTES, "/people/list/p1");
    const buttons = await screen.findAllByRole("button", { name: "別の人に分ける" });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/「11月25日 もくもく会」の回答（LINE名「はなこ🌸」）で新しい人を作り/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "分ける" }));
    await waitFor(() => expect(api.splitResponse).toHaveBeenCalledWith("r2"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/people/list/p9"));
    expect(await screen.findByRole("heading", { name: "はなこ🌸" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // 新しい人は回答が1つだけなので、もう分けられない
    expect(screen.queryByRole("button", { name: "別の人に分ける" })).not.toBeInTheDocument();
  });

  it("回答が1つしかない人には「別の人に分ける」を出さない", async () => {
    api.person.mockResolvedValue(makeDetail({ attendances: [makeDetail().attendances[1]!] }));
    renderRoutes(ROUTES, "/people/list/p1");
    expect(await screen.findByText(EVENT_1011.name)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "別の人に分ける" })).not.toBeInTheDocument();
  });
});

describe("会ったイベント", () => {
  it("作り手のイベント（まだ来ていないもの）から選んで足す", async () => {
    const user = userEvent.setup();
    const third = { id: "e3", name: "12月6日 IT交流会", heldOn: "2026-12-06", isOwn: true, attendeeCount: 0, importCount: 0 };
    api.events.mockResolvedValue([third, EVENT_1125, EVENT_1011]);
    api.addAttendance.mockResolvedValue(makeSummary());
    renderRoutes(ROUTES, "/people/list/p1");
    await user.click(await screen.findByRole("button", { name: /会ったイベントを足す/ }));
    const dialog = await screen.findByRole("dialog");
    const select = await within(dialog).findByLabelText("イベント");
    // もう来たイベントは選べない
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["選んでください", "2026年12月6日 12月6日 IT交流会"]);
    expect(within(dialog).getByRole("button", { name: "足す" })).toBeDisabled();
    await user.selectOptions(select, "e3");
    await user.click(within(dialog).getByRole("button", { name: "足す" }));
    await waitFor(() => expect(api.addAttendance).toHaveBeenCalledWith("p1", "e3"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("手で足した会ったイベントだけ「外す」を出し、確かめてから外す", async () => {
    const user = userEvent.setup();
    api.removeAttendance.mockResolvedValue(undefined);
    api.person.mockResolvedValue(
      makeDetail({
        attendances: [
          { event: { id: "e3", name: "12月6日 IT交流会", heldOn: "2026-12-06", isOwn: true }, via: "manual", responses: [] },
          { event: { id: "e1", name: EVENT_1011.name, heldOn: EVENT_1011.heldOn, isOwn: true }, via: "response", responses: [makeResponse()] },
        ],
      }),
    );
    renderRoutes(ROUTES, "/people/list/p1");
    const remove = await screen.findAllByRole("button", { name: "外す" });
    expect(remove).toHaveLength(1);
    expect(screen.getByText("手で足した")).toBeInTheDocument();
    await user.click(remove[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(api.removeAttendance).toHaveBeenCalledWith("p1", "e3"));
  });
});
