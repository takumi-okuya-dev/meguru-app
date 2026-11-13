// 人のページの声かけリストの段：次にやること・来てくれそう度・誕生日・連絡の記録・自由な項目・SNS のリンク
// （specs/people/002-sales-list tasks.md T216・T219、spec US2〜US4・US6、FR-104〜FR-107・FR-109・FR-110）。
import { jstDate } from "@meguru/shared/people";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDetail, makeSummary, renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
const api = {
  person: vi.fn(),
  tags: vi.fn(),
  updatePerson: vi.fn(),
  finishNextAction: vi.fn(),
  addContactLog: vi.fn(),
  updateContactLog: vi.fn(),
  deleteContactLog: vi.fn(),
  setPersonFields: vi.fn(),
  setPersonLinks: vi.fn(),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { PersonPage } = await import("@/apps/people/pages/PersonPage");
const { ApiError } = await import("@/lib/api-client");

const ROUTES = [{ path: "/people/list/:personId", element: <PersonPage /> }];

/**
 * 見出しの段を返す。
 * @param name - 見出し
 * @returns 段
 */
async function section(name: string) {
  return (await screen.findByRole("heading", { name, level: 2 })).closest("section")!;
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.person.mockResolvedValue(makeDetail());
  api.tags.mockResolvedValue([]);
  api.updatePerson.mockImplementation(async (_id: string, input: object) => ({ ...makeSummary(), ...input }));
  api.finishNextAction.mockResolvedValue(null);
  api.addContactLog.mockResolvedValue({ id: "l9", contactedOn: "2026-11-13", channel: "line", note: "x", createdAt: "" });
  api.updateContactLog.mockResolvedValue({ id: "l1", contactedOn: "2026-11-13", channel: "line", note: "x", createdAt: "" });
  api.deleteContactLog.mockResolvedValue(null);
  api.setPersonFields.mockResolvedValue([]);
  api.setPersonLinks.mockResolvedValue({});
});

describe("次にやること", () => {
  it("日付と文で決める（日付の初めは今日）", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list/p1");
    const s = await section("声かけの予定");
    expect(within(s).getByLabelText("いつ")).toHaveValue(jstDate(new Date()));
    await user.clear(within(s).getByLabelText("いつ"));
    await user.type(within(s).getByLabelText("いつ"), "2026-11-20");
    await user.type(within(s).getByLabelText("何をするか"), "12月の会の案内を送る");
    await user.click(within(s).getByRole("button", { name: "次にやることを保存" }));
    expect(api.updatePerson).toHaveBeenCalledWith("p1", { nextActionOn: "2026-11-20", nextActionNote: "12月の会の案内を送る" });
  });

  it("「終わった」で、連絡の記録に残すか残さないかを選んで終える。消すもできる", async () => {
    const user = userEvent.setup();
    api.person.mockResolvedValue(makeDetail({ person: makeSummary({ nextAction: { on: "2000-01-01", note: "お礼を送る" } }) }));
    renderRoutes(ROUTES, "/people/list/p1");
    const s = await section("声かけの予定");
    expect(within(s).getByText(/2000年1月1日：お礼を送る（過ぎています）/)).toBeInTheDocument();
    await user.click(within(s).getByRole("button", { name: "終わった" }));
    const choice = within(s).getByRole("group", { name: "終わったときの記録" });
    await user.click(within(choice).getByRole("button", { name: "記録に残して終える" }));
    expect(api.finishNextAction).toHaveBeenCalledWith("p1", true);
    await user.click(within(s).getByRole("button", { name: "終わった" }));
    await user.click(within(s).getByRole("button", { name: "残さずに終える" }));
    expect(api.finishNextAction).toHaveBeenLastCalledWith("p1", false);
    await user.click(within(s).getByRole("button", { name: "消す" }));
    expect(api.updatePerson).toHaveBeenCalledWith("p1", { nextActionOn: null, nextActionNote: null });
  });

  it("文が200文字を超えると保存できない", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list/p1");
    const s = await section("声かけの予定");
    await user.type(within(s).getByLabelText("何をするか"), "あ".repeat(201));
    expect(within(s).getByText("200文字までにしてください。")).toBeInTheDocument();
    expect(within(s).getByRole("button", { name: "次にやることを保存" })).toBeDisabled();
  });
});

describe("来てくれそう度と誕生日", () => {
  it("来てくれそう度は押すとすぐ残す（高・中・低・なし）", async () => {
    const user = userEvent.setup();
    api.person.mockResolvedValue(makeDetail({ person: makeSummary({ likelihood: 1 }) }));
    renderRoutes(ROUTES, "/people/list/p1");
    const group = await screen.findByRole("group", { name: "来てくれそう度" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["高", "中", "低", "なし"]);
    expect(within(group).getByRole("button", { name: "低" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "高" }));
    expect(api.updatePerson).toHaveBeenCalledWith("p1", { likelihood: 3 });
    await user.click(within(group).getByRole("button", { name: "なし" }));
    expect(api.updatePerson).toHaveBeenLastCalledWith("p1", { likelihood: null });
  });

  it("誕生日は月日だけ。ない日（2月30日・4月31日）は選べない。うるう日は選べる", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list/p1");
    const s = await section("声かけの予定");
    await user.selectOptions(within(s).getByLabelText("月"), "02");
    const day = within(s).getByLabelText("日");
    expect(within(day).queryByRole("option", { name: "30日" })).not.toBeInTheDocument();
    await user.selectOptions(day, "29");
    await user.click(within(s).getByRole("button", { name: "誕生日を保存" }));
    expect(api.updatePerson).toHaveBeenCalledWith("p1", { birthdayMd: "02-29" });
    await user.selectOptions(within(s).getByLabelText("月"), "04");
    expect(within(within(s).getByLabelText("日")).queryByRole("option", { name: "31日" })).not.toBeInTheDocument();
  });

  it("31日を選んだあとで30日までの月にすると、日を選び直す", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list/p1");
    const s = await section("声かけの予定");
    await user.selectOptions(within(s).getByLabelText("月"), "01");
    await user.selectOptions(within(s).getByLabelText("日"), "31");
    await user.selectOptions(within(s).getByLabelText("月"), "06");
    expect(within(s).getByLabelText("日")).toHaveValue("");
    expect(within(s).getByRole("button", { name: "誕生日を保存" })).toBeDisabled();
  });
});

describe("連絡の記録", () => {
  it("日付（初めは今日）・何で・内容で足す", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list/p1");
    const s = await section("連絡の記録");
    expect(within(s).getByLabelText("いつ")).toHaveValue(jstDate(new Date()));
    expect(within(within(s).getByLabelText("何で")).getAllByRole("option").map((o) => o.textContent)).toEqual(["LINE", "会場で", "そのほか"]);
    await user.selectOptions(within(s).getByLabelText("何で"), "venue");
    await user.type(within(s).getByLabelText("内容"), " 12月の会に興味あり ");
    await user.click(within(s).getByRole("button", { name: "記録を足す" }));
    expect(api.addContactLog).toHaveBeenCalledWith("p1", { contactedOn: jstDate(new Date()), channel: "venue", note: "12月の会に興味あり" });
  });

  it("新しい順に出し、直す・消す（消すは確かめてから）", async () => {
    const user = userEvent.setup();
    api.person.mockResolvedValue(
      makeDetail({
        contactLogs: [
          { id: "l2", contactedOn: "2026-11-10", channel: "line", note: "日程を聞いた", createdAt: "" },
          { id: "l1", contactedOn: "2026-10-11", channel: "venue", note: "初めて話した", createdAt: "" },
        ],
      }),
    );
    renderRoutes(ROUTES, "/people/list/p1");
    const list = await screen.findByRole("list", { name: "連絡の記録の一覧" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("2026年11月10日LINE日程を聞いた");
    expect(items[1]).toHaveTextContent("会場で");
    await user.click(within(items[0]!).getByRole("button", { name: "直す" }));
    const note = within(items[0]!).getByLabelText("内容");
    await user.clear(note);
    await user.type(note, "日程を聞いた。来月返事");
    await user.click(within(items[0]!).getByRole("button", { name: "直す" }));
    expect(api.updateContactLog).toHaveBeenCalledWith("l2", { contactedOn: "2026-11-10", channel: "line", note: "日程を聞いた。来月返事" });
    await user.click(within(items[1]!).getByRole("button", { name: "消す" }));
    expect(api.deleteContactLog).not.toHaveBeenCalled();
    await user.click(within(items[1]!).getByRole("button", { name: "本当に消す" }));
    expect(api.deleteContactLog).toHaveBeenCalledWith("l1");
  });

  it("「やったこと」の記録は、種類を直せない（種類を送らない）", async () => {
    const user = userEvent.setup();
    api.person.mockResolvedValue(makeDetail({ contactLogs: [{ id: "l3", contactedOn: "2026-11-12", channel: "done", note: "お礼を送る", createdAt: "" }] }));
    renderRoutes(ROUTES, "/people/list/p1");
    const list = await screen.findByRole("list", { name: "連絡の記録の一覧" });
    const item = within(list).getByRole("listitem");
    expect(item).toHaveTextContent("やったこと");
    await user.click(within(item).getByRole("button", { name: "直す" }));
    expect(within(item).queryByRole("combobox", { name: "何で" })).not.toBeInTheDocument();
    expect(within(item).getByText("やったこと（直せません）")).toBeInTheDocument();
    await user.click(within(item).getByRole("button", { name: "直す" }));
    expect(api.updateContactLog).toHaveBeenCalledWith("l3", { contactedOn: "2026-11-12", note: "お礼を送る" });
  });
});

describe("自由な項目", () => {
  it("項目の順に値を入れて保存する（空にすると消す）", async () => {
    const user = userEvent.setup();
    api.person.mockResolvedValue(
      makeDetail({
        fields: [
          { fieldId: "f1", label: "好きなもの", value: "コーヒー" },
          { fieldId: "f2", label: "紹介された本", value: null },
        ],
      }),
    );
    renderRoutes(ROUTES, "/people/list/p1");
    const s = await section("自由な項目");
    expect(within(s).getByLabelText("好きなもの")).toHaveValue("コーヒー");
    const save = within(s).getByRole("button", { name: "項目を保存" });
    expect(save).toBeDisabled();
    await user.clear(within(s).getByLabelText("好きなもの"));
    await user.type(within(s).getByLabelText("紹介された本"), "リーダブルコード");
    await user.click(save);
    expect(api.setPersonFields).toHaveBeenCalledWith("p1", [
      { fieldId: "f1", value: null },
      { fieldId: "f2", value: "リーダブルコード" },
    ]);
  });

  it("項目がなければ、設定で足せると出す", async () => {
    renderRoutes(ROUTES, "/people/list/p1");
    const s = await section("自由な項目");
    expect(within(s).getByRole("link", { name: "設定" })).toHaveAttribute("href", "/people/settings");
  });
});

describe("SNS のリンク", () => {
  it("押すと新しいタブで開く（rel=noopener noreferrer）", async () => {
    api.person.mockResolvedValue(makeDetail({ links: { instagram: "https://www.instagram.com/hanako", x: "https://x.com/hanako" } }));
    renderRoutes(ROUTES, "/people/list/p1");
    const link = await screen.findByRole("link", { name: /Instagramを開く/ });
    expect(link).toHaveAttribute("href", "https://www.instagram.com/hanako");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: /Xを開く/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Facebookを開く/ })).not.toBeInTheDocument();
  });

  it("そのサービスの https の URL だけ保存できる。空は外す", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people/list/p1");
    const s = await section("SNS のリンク");
    await user.click(within(s).getByRole("button", { name: "リンクを直す" }));
    const insta = within(s).getByLabelText("Instagram");
    await user.type(insta, "https://evil.example.com/instagram.com");
    expect(within(s).getByText(/Instagramの https:\/\/ から始まるプロフィールのURL/)).toBeInTheDocument();
    expect(within(s).getByRole("button", { name: "リンクを保存" })).toBeDisabled();
    await user.clear(insta);
    await user.type(insta, "http://instagram.com/hanako");
    expect(within(s).getByRole("button", { name: "リンクを保存" })).toBeDisabled();
    await user.clear(insta);
    await user.type(insta, "https://www.instagram.com/hanako");
    await user.type(within(s).getByLabelText("X"), "https://twitter.com/hanako");
    await user.click(within(s).getByRole("button", { name: "リンクを保存" }));
    expect(api.setPersonLinks).toHaveBeenCalledWith("p1", { instagram: "https://www.instagram.com/hanako", x: "https://twitter.com/hanako", facebook: null });
  });

  it("APIが断ったら（400）文言を出す", async () => {
    const user = userEvent.setup();
    api.setPersonLinks.mockRejectedValue(new ApiError("VALIDATION_FAILED", 400));
    renderRoutes(ROUTES, "/people/list/p1");
    const s = await section("SNS のリンク");
    await user.click(within(s).getByRole("button", { name: "リンクを直す" }));
    await user.type(within(s).getByLabelText("Facebook"), "https://facebook.com/hanako");
    await user.click(within(s).getByRole("button", { name: "リンクを保存" }));
    await waitFor(() => expect(within(s).getByRole("alert")).toBeInTheDocument());
  });
});
