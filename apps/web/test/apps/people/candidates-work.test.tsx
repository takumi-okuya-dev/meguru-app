// 仕事の相談先へのつなぎ（specs/people/001-people-memo tasks.md T088、spec US6、contracts/ui-routes.md 3、research.md R16、FR-023）。
// ?purpose=work の切り替え・声かけを始める（相談先の名前を入れる）・「OKをもらった」の前に「つないだ」を出さない・同意がないとき・人のページの記録。
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_1213, makeCandidate, makeDetail, makeOutreach, renderRoutes } from "./helpers";

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
  person: vi.fn(),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { CandidatesPage } = await import("@/apps/people/pages/CandidatesPage");
const { PersonPage } = await import("@/apps/people/pages/PersonPage");
const { ApiError } = await import("@/lib/api-client");

const ROUTES = [
  { path: "/people", element: <CandidatesPage /> },
  { path: "/people/list/:personId", element: <PersonPage /> },
];

/**
 * 仕事のつなぎの声かけを作る（相談先「佐藤さん」・本人に聞いた）。
 * @param over - 上書き
 * @returns 声かけ
 */
function workOutreach(over: Parameters<typeof makeOutreach>[0] = {}) {
  return makeOutreach({ id: "w1", purpose: "work", event: null, targetName: "佐藤さん", stage: "asked", ...over });
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
  api.stats.mockResolvedValue({ repeaterCount: 0, repeaterGoal: null, nextOwnEvent: { id: EVENT_1213.id, name: EVENT_1213.name, heldOn: EVENT_1213.heldOn, isOwn: true } });
  api.settings.mockResolvedValue({ inviteTemplate: null, repeaterGoal: null });
  api.events.mockResolvedValue([EVENT_1213]);
  api.facets.mockResolvedValue({ nextAttendance: [], wantedConnections: [], careerInterests: [] });
  api.candidates.mockResolvedValue({ persons: [makeCandidate({ consent: { invite: false, work: true } })], total: 1 });
  api.createOutreach.mockResolvedValue(workOutreach());
  api.updateOutreach.mockResolvedValue(workOutreach({ stage: "approved" }));
  api.deleteOutreach.mockResolvedValue(null);
});

describe("仕事の相談先へのつなぎ", () => {
  it("切り替えると ?purpose=work で、その目的の候補を読み、本人のOKのあとでつなぐことを出す。人材の言葉は使わない", async () => {
    const user = userEvent.setup();
    const router = renderRoutes(ROUTES, "/people");
    await firstRow();
    await user.click(screen.getByRole("button", { name: "仕事の相談先へのつなぎ" }));
    expect(router.state.location.search).toBe("?purpose=work");
    await waitFor(() => expect(api.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: "work" })));
    expect(screen.getByText(/本人に聞いて、OKをもらってからつなぎます/)).toBeInTheDocument();
    const row = await firstRow();
    expect(within(row).getByRole("button", { name: "声かけを始める" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /文をコピー/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/人材|転職エージェント|紹介/);
  });

  it("「声かけを始める」で相談先の名前を入れて始める（前後の空白は外す・空や100文字を超える名前は送らない）", async () => {
    const user = userEvent.setup();
    renderRoutes(ROUTES, "/people?purpose=work");
    const row = await firstRow();
    await user.click(within(row).getByRole("button", { name: "声かけを始める" }));
    const box = within(row).getByLabelText("相談先の名前");
    const submit = within(row).getByRole("button", { name: "声かけを始める" });
    expect(submit).toBeDisabled();
    await user.type(box, "あ".repeat(101));
    expect(within(row).getByText("100文字までにしてください。")).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await user.clear(box);
    await user.type(box, "  佐藤さん ");
    api.candidates.mockResolvedValue({ persons: [makeCandidate({ outreach: workOutreach() })], total: 1 });
    await user.click(submit);
    expect(api.createOutreach).toHaveBeenCalledWith({ personId: "p1", purpose: "work", targetName: "佐藤さん" });
    expect(await within(row).findByText("佐藤さん")).toBeInTheDocument();
    expect(within(row).queryByLabelText("相談先の名前")).not.toBeInTheDocument();
  });

  it("「OKをもらった」の前は「つないだ」を出さない。OKのあとは出て、押すとつないだにする", async () => {
    const user = userEvent.setup();
    api.candidates.mockResolvedValue({ persons: [makeCandidate({ outreach: workOutreach() })], total: 1 });
    renderRoutes(ROUTES, "/people?purpose=work");
    const row = await firstRow();
    const group = within(row).getByRole("group", { name: "進み具合" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["本人に聞いた", "OKをもらった"]);
    expect(within(group).getByRole("button", { name: "本人に聞いた" })).toHaveAttribute("aria-pressed", "true");
    expect(within(row).queryByRole("button", { name: "つないだ" })).not.toBeInTheDocument();

    api.candidates.mockResolvedValue({ persons: [makeCandidate({ outreach: workOutreach({ stage: "approved", approvedAt: "2026-11-21T03:00:00.000Z" }) })], total: 1 });
    await user.click(within(group).getByRole("button", { name: "OKをもらった" }));
    expect(api.updateOutreach).toHaveBeenCalledWith("w1", "approved");
    const connect = await within(row).findByRole("button", { name: "つないだ" });
    await user.click(connect);
    expect(api.updateOutreach).toHaveBeenLastCalledWith("w1", "connected");
  });

  it("OKの前につないだにしようとして 409 OUTREACH_NEEDS_APPROVAL が返ったら、その文言を出す", async () => {
    const user = userEvent.setup();
    api.candidates.mockResolvedValue({ persons: [makeCandidate({ outreach: workOutreach({ stage: "approved", approvedAt: "2026-11-21T03:00:00.000Z" }) })], total: 1 });
    api.updateOutreach.mockRejectedValue(new ApiError("OUTREACH_NEEDS_APPROVAL", 409));
    renderRoutes(ROUTES, "/people?purpose=work");
    const row = await firstRow();
    await user.click(within(row).getByRole("button", { name: "つないだ" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("先に「OKをもらった」にしてください。");
  });

  it("仕事のつなぎの同意がなければ（409 OUTREACH_NO_CONSENT）、その文言を出す", async () => {
    const user = userEvent.setup();
    api.createOutreach.mockRejectedValue(new ApiError("OUTREACH_NO_CONSENT", 409));
    renderRoutes(ROUTES, "/people?purpose=work");
    const row = await firstRow();
    await user.click(within(row).getByRole("button", { name: "声かけを始める" }));
    await user.type(within(row).getByLabelText("相談先の名前"), "佐藤さん");
    await user.click(within(row).getByRole("button", { name: "声かけを始める" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("この人は、この目的の個別の案内に同意していません。");
  });

  it("同じ人に別の相談先の声かけを足せる。記録を消せる", async () => {
    const user = userEvent.setup();
    api.candidates.mockResolvedValue({ persons: [makeCandidate({ outreach: workOutreach() })], total: 1 });
    api.createOutreach.mockResolvedValue(workOutreach({ id: "w2", targetName: "鈴木さん" }));
    renderRoutes(ROUTES, "/people?purpose=work");
    const row = await firstRow();
    await user.click(within(row).getByRole("button", { name: /別の相談先を足す/ }));
    await user.type(within(row).getByLabelText("相談先の名前"), "鈴木さん");
    await user.click(within(row).getByRole("button", { name: "声かけを始める" }));
    expect(api.createOutreach).toHaveBeenCalledWith({ personId: "p1", purpose: "work", targetName: "鈴木さん" });
    await user.click(within(row).getByRole("button", { name: "声かけの記録を消す" }));
    expect(api.deleteOutreach).toHaveBeenCalledWith("w1");
  });
});

describe("人のページの仕事のつなぎの記録", () => {
  it("いつ・どの相談先へ・進み具合・「あなたが記録」を出し、交流会への誘いと並べる", async () => {
    api.person.mockResolvedValue(
      makeDetail({
        outreaches: [
          workOutreach({ stage: "connected", approvedAt: "2026-11-21T03:00:00.000Z", connectedAt: "2026-11-22T03:00:00.000Z" }),
          makeOutreach(),
        ],
      }),
    );
    renderRoutes(ROUTES, "/people/list/p1");
    const section = (await screen.findByRole("heading", { name: "声かけの記録" })).closest("section")!;
    const items = within(section).getAllByRole("listitem").filter((li) => li.textContent?.includes("あなたが記録"));
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("仕事の相談先へのつなぎ（相談先：佐藤さん）");
    expect(items[0]).toHaveTextContent(/本人に聞いた：/);
    expect(items[0]).toHaveTextContent(/OKをもらった：/);
    expect(items[0]).toHaveTextContent(/つないだ：/);
    expect(items[1]).toHaveTextContent("IT交流会 12/13への誘い");
    expect(section.textContent).not.toMatch(/人材|転職エージェント/);
  });
});
