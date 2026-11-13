// 誘う候補の画面（specs/people/001-people-memo tasks.md T073、contracts/ui-routes.md 1・3、research.md R17）。
// 誘う会の初めの値・絞り込み・文をコピー（使えないときは文を選んだ欄）・興味を聞いたにする・進み具合・誘う会がないとき・同意の一行。
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_1011, EVENT_1125, EVENT_1213, makeCandidate, makeOutreach, renderRoutes } from "./helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = {
  candidates: vi.fn(),
  stats: vi.fn(),
  settings: vi.fn(),
  events: vi.fn(),
  facets: vi.fn(),
  createOutreach: vi.fn(),
  updateOutreach: vi.fn(),
  deleteOutreach: vi.fn(),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { CandidatesPage } = await import("@/apps/people/pages/CandidatesPage");
const { candidateSearch } = await import("@/apps/people/lib/api");
const { ApiError } = await import("@/lib/api-client");

const ROUTES = [
  { path: "/people", element: <CandidatesPage /> },
  { path: "/people/settings", element: <p>設定の画面</p> },
];

/**
 * クリップボードを置き換える（userEvent.setup() のあとに呼ぶ。setup がクリップボードを差し替えるため）。
 * @param writeText - 書く処理（undefined ならクリップボードがないブラウザ）
 */
function setClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", { value: writeText ? { writeText } : undefined, configurable: true });
}

/**
 * 1行目の候補を返す（読み込みを待つ）。
 * @returns 行
 */
async function firstRow() {
  await screen.findByText("山田はなこ");
  return screen.getAllByRole("listitem").find((li) => li.textContent?.includes("山田はなこ"))!;
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.stats.mockResolvedValue({ repeaterCount: 4, repeaterGoal: 10, nextOwnEvent: { id: EVENT_1213.id, name: EVENT_1213.name, heldOn: EVENT_1213.heldOn, isOwn: true } });
  api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: 10 });
  api.events.mockResolvedValue([EVENT_1213, EVENT_1125, EVENT_1011]);
  api.facets.mockResolvedValue({
    nextAttendance: [{ value: "参加できそう", count: 5 }],
    wantedConnections: [{ value: "エンジニア", count: 3 }],
    careerInterests: [{ value: "転職", count: 1 }],
  });
  api.candidates.mockResolvedValue({ persons: [makeCandidate()], total: 1 });
  api.createOutreach.mockResolvedValue(makeOutreach());
  api.updateOutreach.mockResolvedValue(makeOutreach({ stage: "link_sent" }));
  api.deleteOutreach.mockResolvedValue(null);
});

describe("誘う候補のクエリ", () => {
  it("目的・誘う会・前に来た・絞り込みを送る。仕事のつなぎでは誘う会を送らない", () => {
    expect(candidateSearch({ purpose: "invite", eventId: "e3", visitedOwn: true, next: ["参加できそう"] })).toBe(
      `?purpose=invite&eventId=e3&next=${encodeURIComponent("参加できそう")}&visitedOwn=true`,
    );
    expect(candidateSearch({ purpose: "work", eventId: "e3", visitedOwn: false })).toBe("?purpose=work");
  });
});

describe("誘う候補", () => {
  it("上に「個別の案内に同意した人だけを出しています」。誘う会は初めから次の自分の会で、その会の候補を読む", async () => {
    renderRoutes(ROUTES, "/people");
    expect(screen.getByText("個別の案内に同意した人だけを出しています")).toBeInTheDocument();
    const row = await firstRow();
    expect(row).toHaveTextContent("LINE：はな");
    expect(row).toHaveTextContent("最後に会った日 2026年10月11日");
    expect(within(row).getByText("次回：参加したい")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /山田はなこ/ })).toHaveAttribute("href", "/people/list/p1");
    expect(api.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: "invite", eventId: "e3", offset: 0 }));
    // 選べるのは自分の会だけ
    const picker = screen.getByLabelText("誘う会");
    expect(picker).toHaveValue("e3");
    const options = within(picker).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["選んでいません", "2026年12月13日 IT交流会 12/13", "2026年10月11日 10月11日 IT交流会"]);
    expect(screen.queryByText("誘う会を選んでください（文のコピーに使います）。")).not.toBeInTheDocument();
  });

  it("「前に来た」「次回参加」で絞る。来たイベントの絞り込みは出さない（eventId は誘う会のため）", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people");
    await firstRow();
    await user.click(screen.getByRole("button", { name: /絞り込み/ }));
    expect(screen.queryByLabelText("来たイベント")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "前に来た" }));
    await waitFor(() => expect(api.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ visitedOwn: true, eventId: "e3" })));
    await user.click(screen.getByRole("button", { name: "参加できそう" }));
    await waitFor(() => expect(api.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ visitedOwn: true, next: ["参加できそう"] })));
    await user.click(screen.getByRole("button", { name: "絞り込みを外す" }));
    await waitFor(() => expect(api.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ visitedOwn: false, next: [] })));
  });

  it("「文をコピー」で、名前・会の名前・日にちの入った文をクリップボードに書く。そのあと「興味を聞いたにする」で声かけを始める", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    setClipboard(writeText);
    renderRoutes(ROUTES, "/people");
    const row = await firstRow();
    expect(within(row).queryByRole("button", { name: "興味を聞いたにする" })).not.toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: /文をコピー/ }));
    expect(writeText).toHaveBeenCalledWith("山田はなこさん、12月13日（日）のIT交流会 12/13、もしご興味あれば一緒にいかがですか？");
    // コピーではAPIを呼ばない
    expect(api.createOutreach).not.toHaveBeenCalled();
    api.candidates.mockResolvedValue({ persons: [makeCandidate({ outreach: makeOutreach() })], total: 1 });
    await user.click(within(row).getByRole("button", { name: "興味を聞いたにする" }));
    expect(api.createOutreach).toHaveBeenCalledWith({ personId: "p1", eventId: "e3" });
    const group = await within(row).findByRole("group", { name: "進み具合" });
    expect(within(group).getByRole("button", { name: "興味を聞いた" })).toHaveAttribute("aria-pressed", "true");
    expect(within(row).queryByRole("button", { name: "興味を聞いたにする" })).not.toBeInTheDocument();
  });

  it("作り手の型があれば、その型で文を作る", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    setClipboard(writeText);
    api.settings.mockResolvedValue({ inviteTemplate: "{名前}さん、{会の名前}（{日にち}）どうですか？ https://example.com/join", repeaterGoal: null });
    renderRoutes(ROUTES, "/people");
    const row = await firstRow();
    await waitFor(() => expect(within(row).getByRole("button", { name: /文をコピー/ })).toBeEnabled());
    await user.click(within(row).getByRole("button", { name: /文をコピー/ }));
    expect(writeText).toHaveBeenCalledWith("山田はなこさん、IT交流会 12/13（12月13日（日））どうですか？ https://example.com/join");
  });

  it("クリップボードが使えないときは、文を選んだ欄を出す。そのあとも「興味を聞いたにする」を出す", async () => {
    const user = userEvent.setup();
    setClipboard(undefined);
    renderRoutes(ROUTES, "/people");
    const row = await firstRow();
    await user.click(within(row).getByRole("button", { name: /文をコピー/ }));
    const dialog = await screen.findByRole("dialog", { name: "この文をコピーしてください" });
    const box = within(dialog).getByLabelText<HTMLTextAreaElement>("誘いの文");
    expect(box.value).toContain("山田はなこさん");
    expect(box.value).toContain("IT交流会 12/13");
    expect(box.value).toContain("12月13日（日）");
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(box.value.length);
    await user.click(within(dialog).getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "興味を聞いたにする" })).toBeInTheDocument();
  });

  it("書くのを断られたとき（writeText が失敗）も、文を選んだ欄を出す", async () => {
    const user = userEvent.setup();
    setClipboard(vi.fn(async () => Promise.reject(new Error("denied"))));
    renderRoutes(ROUTES, "/people");
    const row = await firstRow();
    await user.click(within(row).getByRole("button", { name: /文をコピー/ }));
    expect(await screen.findByRole("dialog", { name: "この文をコピーしてください" })).toBeInTheDocument();
  });

  it("進み具合のボタンで段を変える。記録を消せる", async () => {
    const user = userEvent.setup();
    api.candidates.mockResolvedValue({ persons: [makeCandidate({ outreach: makeOutreach() })], total: 1 });
    renderRoutes(ROUTES, "/people");
    const row = await firstRow();
    const group = within(row).getByRole("group", { name: "進み具合" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["興味を聞いた", "参加リンクを送った", "来た"]);
    await user.click(within(group).getByRole("button", { name: "参加リンクを送った" }));
    expect(api.updateOutreach).toHaveBeenCalledWith("o1", "link_sent");
    await user.click(within(group).getByRole("button", { name: "来た" }));
    expect(api.updateOutreach).toHaveBeenLastCalledWith("o1", "attended");
    // 今の段を押しても何もしない
    await user.click(within(group).getByRole("button", { name: "興味を聞いた" }));
    expect(api.updateOutreach).toHaveBeenCalledTimes(2);
    await user.click(within(row).getByRole("button", { name: "声かけの記録を消す" }));
    expect(api.deleteOutreach).toHaveBeenCalledWith("o1");
  });

  it("同意がなくなっていたら（409 OUTREACH_NO_CONSENT）、その文言を出す", async () => {
    const user = userEvent.setup();
    setClipboard(vi.fn(async () => {}));
    api.createOutreach.mockRejectedValue(new ApiError("OUTREACH_NO_CONSENT", 409));
    renderRoutes(ROUTES, "/people");
    const row = await firstRow();
    await user.click(within(row).getByRole("button", { name: /文をコピー/ }));
    await user.click(within(row).getByRole("button", { name: "興味を聞いたにする" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("この人は、この目的の個別の案内に同意していません。");
  });

  it("誘う会がないときは「誘う会を選んでください」で、文をコピーできない。選ぶとコピーできる", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    setClipboard(writeText);
    api.stats.mockResolvedValue({ repeaterCount: 0, repeaterGoal: null, nextOwnEvent: null });
    renderRoutes(ROUTES, "/people");
    const row = await firstRow();
    expect(screen.getByText("誘う会を選んでください（文のコピーに使います）。")).toBeInTheDocument();
    expect(screen.getByLabelText("誘う会")).toHaveValue("");
    expect(within(row).getByRole("button", { name: /文をコピー/ })).toBeDisabled();
    expect(api.candidates).toHaveBeenLastCalledWith(expect.not.objectContaining({ eventId: expect.anything() }));
    await user.selectOptions(screen.getByLabelText("誘う会"), "e1");
    await waitFor(() => expect(api.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ eventId: "e1" })));
    const again = await firstRow();
    await user.click(within(again).getByRole("button", { name: /文をコピー/ }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("10月11日 IT交流会"));
  });

  it("「仕事の相談先へのつなぎ」に切り替えると ?purpose=work で、その目的の候補だけを読む。文のコピーは出さない", async () => {
    const user = userEvent.setup();
    const router = renderRoutes(ROUTES, "/people");
    await firstRow();
    await user.click(screen.getByRole("button", { name: "仕事の相談先へのつなぎ" }));
    expect(router.state.location.search).toBe("?purpose=work");
    await waitFor(() => expect(api.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: "work", eventId: undefined })));
    expect(screen.getByRole("button", { name: "仕事の相談先へのつなぎ" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/仕事の相談先へつなぐ記録は、次の版で足します/)).toBeInTheDocument();
    expect(screen.queryByLabelText("誘う会")).not.toBeInTheDocument();
    await firstRow();
    expect(screen.queryByRole("button", { name: /文をコピー/ })).not.toBeInTheDocument();
    expect(screen.getByText("個別の案内に同意した人だけを出しています")).toBeInTheDocument();
  });

  it("URLには目的だけを置き、探す言葉や絞り込みは置かない", async () => {
    const user = userEvent.setup();
    const router = renderRoutes(ROUTES, "/people");
    await firstRow();
    await user.type(screen.getByLabelText("候補を探す"), "はな");
    await waitFor(() => expect(api.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ q: "はな" })));
    await user.click(screen.getByRole("button", { name: /絞り込み/ }));
    await user.click(screen.getByRole("button", { name: "前に来た" }));
    expect(router.state.location.search).toBe("");
  });
});
