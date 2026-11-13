// 人の一覧と人のページ（specs/people/001-people-memo tasks.md T050、contracts/ui-routes.md 1、research.md R11・R22）。
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_1011, EVENT_1125, makeDetail, makeListItem, makeOutreach, makeSummary, renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = {
  persons: vi.fn(),
  facets: vi.fn(),
  events: vi.fn(),
  person: vi.fn(),
  updatePerson: vi.fn(),
  updateConsent: vi.fn(),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { PeopleListPage } = await import("@/apps/people/pages/PeopleListPage");
const { PersonPage } = await import("@/apps/people/pages/PersonPage");
const { personListSearch } = await import("@/apps/people/lib/api");

const ROUTES = [
  { path: "/people/list", element: <PeopleListPage /> },
  { path: "/people/list/:personId", element: <PersonPage /> },
];

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.persons.mockResolvedValue({
    persons: [makeListItem(), makeListItem({ id: "p2", displayName: "たろう", realName: null, lineName: "たろう", lastMetOn: null })],
    total: 2,
  });
  api.facets.mockResolvedValue({
    nextAttendance: [
      { value: "参加したい", count: 5 },
      { value: "未定", count: 2 },
    ],
    wantedConnections: [{ value: "エンジニア", count: 3 }],
    careerInterests: [{ value: "転職", count: 1 }],
  });
  api.events.mockResolvedValue([EVENT_1125, EVENT_1011]);
  api.person.mockResolvedValue(makeDetail());
});

describe("人の一覧のクエリ", () => {
  it("くり返せる絞り込みは同じ名前で並べ、空の項目は送らない", () => {
    expect(personListSearch({ q: " はな ", next: ["参加したい", "未定"], wanted: [], career: ["転職"], offset: 100 })).toBe(
      `?q=${encodeURIComponent("はな")}&next=${encodeURIComponent("参加したい")}&next=${encodeURIComponent("未定")}&career=${encodeURIComponent("転職")}&offset=100`,
    );
    expect(personListSearch({ q: "", next: [], offset: 0 })).toBe("");
  });
});

describe("人の一覧", () => {
  it("行に名前・LINE名・最後に会った日を出し、人のページへつなぐ。「人を足す」を置く", async () => {
    renderRoutes(ROUTES, "/people/list");
    const rows = await screen.findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("山田はなこ");
    expect(rows[0]).toHaveTextContent("LINE：はな");
    expect(rows[0]).toHaveTextContent("最後に会った日 2026年10月11日");
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute("href", "/people/list/p1");
    // 名前がLINE名だけの人は、LINE名を重ねて出さない
    expect(rows[1]).toHaveTextContent("たろう");
    expect(rows[1]).not.toHaveTextContent("LINE：");
    expect(rows[1]).toHaveTextContent("会ったイベントなし");
    expect(screen.getByText("全 2人")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /人を足す/ })).toHaveAttribute("href", "/people/list/new");
  });

  it("探す欄に入れると、少し待ってから言葉で探す", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list");
    await screen.findByText("全 2人");
    api.persons.mockResolvedValue({ persons: [makeListItem()], total: 1 });
    await user.type(screen.getByLabelText("人を探す"), "はな");
    await waitFor(() => expect(api.persons).toHaveBeenLastCalledWith(expect.objectContaining({ q: "はな", offset: 0 })));
    expect(await screen.findByText("当てはまる人 1人")).toBeInTheDocument();
  });

  it("絞り込みのチップは選べる値（facets）から出し、押すとその値で絞る。押し直すと外す", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list");
    await screen.findByText("全 2人");
    await user.click(screen.getByRole("button", { name: /絞り込み/ }));
    expect(screen.getByRole("group", { name: "次回参加" })).toBeInTheDocument();
    const chip = screen.getByRole("button", { name: /参加したい/ });
    expect(chip).toHaveTextContent("5人");
    expect(screen.getByRole("button", { name: /エンジニア/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /転職/ })).toBeInTheDocument();
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(api.persons).toHaveBeenLastCalledWith(expect.objectContaining({ next: ["参加したい"] })));
    await user.selectOptions(screen.getByLabelText("来たイベント"), "e1");
    await waitFor(() => expect(api.persons).toHaveBeenLastCalledWith(expect.objectContaining({ next: ["参加したい"], eventId: "e1" })));
    await user.click(chip);
    await waitFor(() => expect(api.persons).toHaveBeenLastCalledWith(expect.objectContaining({ next: [], eventId: "e1" })));
  });

  it("100人を超えると、ページを移れる", async () => {
    const user = userEvent.setup();
    api.persons.mockImplementation(async (p: { offset?: number }) => ({
      persons: [makeListItem({ id: `p${p.offset ?? 0}`, displayName: `人${p.offset ?? 0}` })],
      total: 150,
    }));
    renderRoutes(ROUTES, "/people/list");
    expect(await screen.findByText("全 150人")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "前の100人" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "次の100人" }));
    expect(await screen.findByText("人100")).toBeInTheDocument();
    expect(api.persons).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 100 }));
    expect(screen.getByRole("button", { name: "次の100人" })).toBeDisabled();
  });
});

describe("人の一覧のページの移動", () => {
  it("2ページ目で数が100人以下に減っても、前のページへ戻れる", async () => {
    const user = userEvent.setup();
    api.persons.mockImplementation(async (p: { offset?: number }) =>
      p.offset ? { persons: [], total: 90 } : { persons: [makeListItem({ displayName: "人0" })], total: 150 },
    );
    renderRoutes(ROUTES, "/people/list");
    expect(await screen.findByText("全 150人")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "次の100人" }));
    expect(await screen.findByText("全 90人")).toBeInTheDocument();
    const back = screen.getByRole("button", { name: "前の100人" });
    expect(back).toBeEnabled();
    expect(screen.getByRole("button", { name: "次の100人" })).toBeDisabled();
    await user.click(back);
    expect(await screen.findByText("人0")).toBeInTheDocument();
    expect(api.persons).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));
  });
});

describe("人のページ", () => {
  it("本名・LINE名・別名・同意・メモ・来たイベント（新しい順・答え）を出す", async () => {
    renderRoutes(ROUTES, "/people/list/p1");
    expect(await screen.findByRole("heading", { name: "山田はなこ" })).toBeInTheDocument();
    const names = within(screen.getByRole("region", { name: "名前" }));
    expect(names.getByText("山田はなこ")).toBeInTheDocument();
    expect(names.getByText("はな")).toBeInTheDocument();
    expect(names.getByText("はなこ🌸")).toBeInTheDocument();
    expect(names.getByText("2026年11月25日")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "交流会への誘い" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "仕事の相談先へのつなぎ" })).not.toBeChecked();
    expect(screen.getByText("2026年10月11日の会の回答から決めています。")).toBeInTheDocument();
    expect(screen.getByLabelText("見た目の特徴")).toHaveValue("");
    expect(screen.getByLabelText("話したこと")).toHaveValue("");
    const events = screen.getAllByRole("link", { name: /月.*日 / });
    expect(events.map((l) => l.textContent)).toEqual([EVENT_1125.name, EVENT_1011.name]);
    expect(events[0]).toHaveAttribute("href", "/people/events/e2");
    expect(screen.getAllByText("次回参加").length).toBe(2);
    expect(screen.getAllByText("参加したい", { selector: "dd" }).length).toBe(2);
    // 空の答えは出さない
    expect(screen.queryByText("ひとこと")).not.toBeInTheDocument();
  });

  it("ない人は「ページが見つかりません」", async () => {
    const { ApiError } = await import("@/lib/api-client");
    api.person.mockRejectedValue(new ApiError("ITEM_NOT_FOUND", 404));
    renderRoutes(ROUTES, "/people/list/nope");
    expect(await screen.findByText("ページが見つかりません")).toBeInTheDocument();
  });

  it("メモを書いて保存する（空のメモは null で送る）", async () => {
    const user = userEvent.setup();
    api.updatePerson.mockResolvedValue(makeSummary({ memoAppearance: "背が高い・メガネ" }));
    renderRoutes(ROUTES, "/people/list/p1");
    const save = await screen.findByRole("button", { name: "メモを保存" });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("見た目の特徴"), "背が高い・メガネ");
    expect(save).toBeEnabled();
    api.person.mockResolvedValue(makeDetail({ person: makeSummary({ memoAppearance: "背が高い・メガネ" }) }));
    await user.click(save);
    await waitFor(() => expect(api.updatePerson).toHaveBeenCalledWith("p1", { memoAppearance: "背が高い・メガネ", memoTalk: null }));
    await waitFor(() => expect(screen.getByRole("button", { name: "メモを保存" })).toBeDisabled());
    expect(screen.getByLabelText("見た目の特徴")).toHaveValue("背が高い・メガネ");
  });

  it("上限を超えたメモは保存できない", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list/p1");
    const field = await screen.findByLabelText("見た目の特徴");
    await user.click(field);
    await user.paste("あ".repeat(301));
    expect(screen.getByText("300文字以内で入力してください")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "メモを保存" })).toBeDisabled();
  });

  it("同意を直すと、手で直した記録が出る", async () => {
    const user = userEvent.setup();
    api.updateConsent.mockResolvedValue({ invite: true, work: true, source: "manual", basisOn: "2026-11-13" });
    renderRoutes(ROUTES, "/people/list/p1");
    const work = await screen.findByRole("switch", { name: "仕事の相談先へのつなぎ" });
    expect(screen.getByText("同意の記録（1件）")).toBeInTheDocument();
    api.person.mockResolvedValue(
      makeDetail({
        person: makeSummary({ consent: { invite: true, work: true, source: "manual", basisOn: "2026-11-13" } }),
        consentChanges: [
          { invite: true, work: true, source: "manual", basisOn: "2026-11-13", changedAt: "2026-11-13T05:00:00.000Z" },
          { invite: true, work: false, source: "response", basisOn: "2026-10-11", changedAt: "2026-10-12T03:00:00.000Z" },
        ],
      }),
    );
    await user.click(work);
    await waitFor(() => expect(api.updateConsent).toHaveBeenCalledWith("p1", { invite: true, work: true }));
    expect(await screen.findByText("同意の記録（2件）")).toBeInTheDocument();
    await user.click(screen.getByText("同意の記録（2件）"));
    expect(screen.getByText(/手で直した$/)).toBeInTheDocument();
    expect(screen.getByText("交流会への誘い：同意・仕事の相談先へのつなぎ：同意")).toBeInTheDocument();
    expect(screen.getByText(/回答（2026年10月11日の会）/)).toBeInTheDocument();
    expect(screen.getByText("2026年11月13日に手で直した同意です。")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "仕事の相談先へのつなぎ" })).toBeChecked();
  });

  it("あとの日付の回答があって同意が変わらなかったときは、そう伝える", async () => {
    const user = userEvent.setup();
    api.updateConsent.mockResolvedValue({ invite: true, work: false, source: "response", basisOn: "2026-12-06" });
    renderRoutes(ROUTES, "/people/list/p1");
    await user.click(await screen.findByRole("switch", { name: "仕事の相談先へのつなぎ" }));
    expect(await screen.findByText("あとの日付の回答があるため、回答の同意が使われています。")).toBeInTheDocument();
  });

  it("本名を直す", async () => {
    const user = userEvent.setup();
    api.updatePerson.mockResolvedValue(makeSummary({ realName: "山田花子", displayName: "山田花子" }));
    renderRoutes(ROUTES, "/people/list/p1");
    await user.click(await screen.findByRole("button", { name: "本名を直す" }));
    const input = screen.getByLabelText("本名");
    expect(input).toHaveValue("山田はなこ");
    await user.clear(input);
    await user.type(input, " 山田花子 ");
    api.person.mockResolvedValue(makeDetail({ person: makeSummary({ realName: "山田花子", displayName: "山田花子" }) }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.updatePerson).toHaveBeenCalledWith("p1", { realName: "山田花子" }));
    expect(await screen.findByRole("heading", { name: "山田花子" })).toBeInTheDocument();
    expect(screen.queryByLabelText("本名")).not.toBeInTheDocument();
  });

  it("本名を空にすると本名を消す。LINE名のない人は消せない", async () => {
    const user = userEvent.setup();
    api.person.mockResolvedValue(makeDetail({ person: makeSummary({ lineName: null, otherLineNames: [] }) }));
    renderRoutes(ROUTES, "/people/list/p1");
    await user.click(await screen.findByRole("button", { name: "本名を直す" }));
    await user.clear(screen.getByLabelText("本名"));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("LINE名がないので、本名は消せません")).toBeInTheDocument();
    expect(api.updatePerson).not.toHaveBeenCalled();
  });
});

describe("人のページの声かけの記録", () => {
  it("誘う会ごとに、今の進み具合と各段の日時・「あなたが記録」を出す", async () => {
    api.person.mockResolvedValue(
      makeDetail({ outreaches: [makeOutreach({ stage: "link_sent", linkSentAt: "2026-11-22T03:00:00.000Z" })] }),
    );
    renderRoutes(ROUTES, "/people/list/p1");
    const section = (await screen.findByRole("heading", { name: "声かけの記録" })).closest("section")!;
    expect(section).toHaveTextContent("2026年12月13日 IT交流会 12/13への誘い");
    expect(section).toHaveTextContent("参加リンクを送った");
    expect(section).toHaveTextContent(/興味を聞いた：/);
    expect(section).toHaveTextContent(/参加リンクを送った：/);
    expect(section).not.toHaveTextContent(/来た：/);
    expect(section).toHaveTextContent("あなたが記録");
  });

  it("記録がなければ、まだないと出す", async () => {
    renderRoutes(ROUTES, "/people/list/p1");
    const section = (await screen.findByRole("heading", { name: "声かけの記録" })).closest("section")!;
    expect(section).toHaveTextContent("まだ声かけの記録はありません");
  });
});
