// 同じ人の候補と、同じCSVの中の重なり（specs/people/001-people-memo tasks.md T039、contracts/ui-routes.md 2、US2）。
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ImportCandidate, ImportPreviewRow } from "@meguru/shared/people";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetViewport, setViewport } from "../../helpers/viewport";
import { ANSWERS, EVENT_1011, csvText, makePreview, renderRoutes } from "./helpers";

const api = { events: vi.fn(), createEvent: vi.fn(), previewImport: vi.fn(), commitImport: vi.fn() };
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, ...api } };
});

const { ImportPage } = await import("@/apps/people/pages/ImportPage");
const { ApiError } = await import("@/lib/api-client");

/**
 * 候補の人を作る。
 * @param personId - 人のID
 * @param displayName - 名前
 * @param over - 上書き
 * @returns 候補の人
 */
function candidate(personId: string, displayName: string, over: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    personId,
    displayName,
    lineName: displayName,
    otherLineNames: [],
    realName: null,
    reasons: ["line_name"],
    recentEvents: [{ name: "10月11日 IT交流会", heldOn: "2026-10-11" }],
    latestAnswers: { nextAttendance: "参加したい", wantedConnections: ["デザイナー"], careerInterests: [] },
    ...over,
  };
}

const ROWS: ImportPreviewRow[] = [
  { row: 0, status: "candidate", lineName: "たろう", realName: "山田太郎", answers: ANSWERS, candidates: [candidate("p1", "たろう")] },
  {
    row: 1,
    status: "candidate",
    lineName: "はなこ☆",
    realName: "佐藤花子",
    answers: ANSWERS,
    candidates: [
      candidate("p2", "はなこ", { reasons: ["line_name_loose"] }),
      candidate("p3", "佐藤花子", { lineName: "hana", otherLineNames: ["はな"], realName: "佐藤花子", reasons: ["real_name"] }),
    ],
  },
  { row: 2, status: "duplicate_in_file", groupId: 0, lineName: "じろう", realName: null, answers: ANSWERS },
  { row: 3, status: "duplicate_in_file", groupId: 0, lineName: "じろう", realName: "鈴木次郎", answers: ANSWERS },
  { row: 4, status: "new", lineName: "さぶろう", realName: null },
];
const CONFIRM = makePreview(ROWS);
const RESULT = { import: { id: "i1", rowCount: 5, importedCount: 4, createdPeopleCount: 2, linkedCount: 2, skippedCount: 1 } };

/**
 * 確かめの段まで進む（列の対応はAPIがすべて当てたもの）。
 * @returns userEvent
 */
async function goToConfirm() {
  const user = userEvent.setup();
  renderRoutes([{ path: "/people/import", element: <ImportPage /> }], "/people/import");
  const csv = csvText(ROWS.map((r) => ["2026/10/11 21:03:12", r.lineName ?? "", r.realName ?? "", "", ""]));
  await user.upload(screen.getByLabelText(/CSVのファイルを選ぶ/), new File([csv], "answers.csv", { type: "text/csv" }));
  await screen.findByRole("option", { name: /10月11日 IT交流会/ });
  await user.selectOptions(screen.getByLabelText("どのイベントのアンケートですか"), "e1");
  await user.click(screen.getByRole("button", { name: "次へ" }));
  await screen.findAllByTestId("mapping-row");
  await user.click(screen.getByRole("button", { name: "次へ" }));
  await screen.findByRole("heading", { name: "同じ人かどうかを選んでください" });
  return user;
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.events.mockResolvedValue([EVENT_1011]);
  api.previewImport.mockResolvedValueOnce(makePreview([])).mockResolvedValue(CONFIRM);
  api.commitImport.mockResolvedValue(RESULT);
});
afterEach(() => resetViewport());

describe("同じ人の候補", () => {
  it("カードの左に取り込む行、右に候補の人（理由・来たイベント・答え）を出す", async () => {
    await goToConfirm();
    const cards = screen.getAllByTestId("candidate-card");
    expect(cards).toHaveLength(2);
    const [first, second] = cards as [HTMLElement, HTMLElement];
    expect(first).toHaveTextContent("取り込む行（2行目）");
    expect(first).toHaveTextContent("山田太郎");
    expect(first).toHaveTextContent("エンジニア");
    expect(first).toHaveTextContent("転職");
    expect(first).toHaveTextContent("LINE名が同じ");
    expect(first).toHaveTextContent("10月11日 IT交流会（2026年10月11日）");
    expect(first).toHaveTextContent("デザイナー");
    expect(second).toHaveTextContent("記号を除くとLINE名が同じ");
    expect(second).toHaveTextContent("本名が同じ");
    expect(second).toHaveTextContent("はな（前の名前）");
    // 候補が1人なら「つなぐ」、2人以上なら人ごとに「この人につなぐ」
    expect(within(first).getByRole("button", { name: "つなぐ" })).toBeInTheDocument();
    expect(within(second).getAllByRole("button", { name: "この人につなぐ" })).toHaveLength(2);
    expect(within(second).queryByRole("button", { name: "つなぐ" })).not.toBeInTheDocument();
    expect(screen.getByText("決めた組 0 / 3")).toBeInTheDocument();
  });

  it("全部選ぶまで「取り込む」は押せない。つなぐ・この人につなぐ・重なりの1行を残すを送る", async () => {
    const user = await goToConfirm();
    const [first, second] = screen.getAllByTestId("candidate-card") as [HTMLElement, HTMLElement];
    const commit = screen.getByRole("button", { name: "取り込む" });
    expect(commit).toBeDisabled();
    await user.click(within(first).getByRole("button", { name: "つなぐ" }));
    await user.click(within(second).getAllByRole("button", { name: "この人につなぐ" })[1]!);
    expect(commit).toBeDisabled();
    const group = screen.getByTestId("duplicate-group");
    expect(group).toHaveTextContent("同じLINE名の行が2つあります");
    await user.click(within(group).getAllByRole("button", { name: "この行を残す" })[1]!);
    expect(screen.getByText("決めた組 3 / 3")).toBeInTheDocument();
    expect(commit).toBeEnabled();
    await user.click(commit);
    await screen.findByRole("heading", { name: "取り込みました" });
    expect(api.commitImport.mock.calls[0]![0].decisions).toEqual([
      { row: 0, action: "link", personId: "p1" },
      { row: 1, action: "link", personId: "p3" },
      { row: 2, action: "skip" },
      { row: 3, action: "new" },
    ]);
  });

  it("「別の人」と「全部、別の人として入れる」は新しい人として送る", async () => {
    const user = await goToConfirm();
    for (const card of screen.getAllByTestId("candidate-card")) await user.click(within(card).getByRole("button", { name: "別の人" }));
    await user.click(screen.getByRole("button", { name: "全部、別の人として入れる" }));
    await user.click(screen.getByRole("button", { name: "取り込む" }));
    await screen.findByRole("heading", { name: "取り込みました" });
    expect(api.commitImport.mock.calls[0]![0].decisions).toEqual([0, 1, 2, 3].map((row) => ({ row, action: "new" })));
  });

  it("409（準備のあとで人が増えた）なら、プレビューを読み直して決めていない組に戻る", async () => {
    const user = await goToConfirm();
    const [first, second] = screen.getAllByTestId("candidate-card") as [HTMLElement, HTMLElement];
    await user.click(within(first).getByRole("button", { name: "つなぐ" }));
    await user.click(within(second).getByRole("button", { name: "別の人" }));
    await user.click(screen.getByRole("button", { name: "全部、別の人として入れる" }));
    // 読み直すと、さぶろう（新しい人の行）に候補ができている
    const grown = makePreview(ROWS.map((r) => (r.row === 4 ? { ...r, status: "candidate" as const, candidates: [candidate("p9", "さぶろう")] } : r)));
    api.previewImport.mockResolvedValue(grown);
    api.commitImport.mockRejectedValueOnce(new ApiError("IMPORT_DECISIONS_REQUIRED", 409));
    await user.click(screen.getByRole("button", { name: "取り込む" }));
    expect(await screen.findByText("取り込みの準備のあとで人が増えました。決めていない組を選び直してください。")).toBeInTheDocument();
    expect(api.previewImport).toHaveBeenCalledTimes(3);
    expect(screen.getAllByTestId("candidate-card")).toHaveLength(3);
    expect(screen.getByText("決めた組 3 / 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取り込む" })).toBeDisabled();
    const added = screen.getAllByTestId("candidate-card")[2]!;
    await user.click(within(added).getByRole("button", { name: "別の人" }));
    await user.click(screen.getByRole("button", { name: "取り込む" }));
    await screen.findByRole("heading", { name: "取り込みました" });
    expect(api.commitImport.mock.calls[1]![0].decisions).toEqual([
      { row: 0, action: "link", personId: "p1" },
      { row: 1, action: "new" },
      { row: 2, action: "new" },
      { row: 3, action: "new" },
      { row: 4, action: "new" },
    ]);
  });

  it("390px幅では1組ずつ出し、決めると次の組へ進む", async () => {
    setViewport(390);
    const user = await goToConfirm();
    expect(screen.getAllByTestId("candidate-card")).toHaveLength(1);
    expect(screen.queryByTestId("duplicate-group")).not.toBeInTheDocument();
    expect(screen.getByText("1組目 / 全3組")).toBeInTheDocument();
    await user.click(within(screen.getByTestId("candidate-card")).getByRole("button", { name: "つなぐ" }));
    expect(screen.getByText("2組目 / 全3組")).toBeInTheDocument();
    expect(screen.getByTestId("candidate-card")).toHaveTextContent("はなこ☆");
    await user.click(within(screen.getByTestId("candidate-card")).getByRole("button", { name: "別の人" }));
    expect(screen.getByText("3組目 / 全3組")).toBeInTheDocument();
    expect(screen.getByTestId("duplicate-group")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "前の組" }));
    expect(screen.getByText("2組目 / 全3組")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "取り込む" })).toBeDisabled());
  });
});
