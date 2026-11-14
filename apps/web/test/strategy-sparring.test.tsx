// AIと考える（区分ごとのポップアップ。specs/018-strategy-ai-sparring US1〜US4、contracts/ui-routes.md、SC-001〜SC-005）。
// 2026-11-04：全部の項目を一度に相談するのは大変なので、区分の見出しの横から、区分ごとのポップアップで開く形にした
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  SPARRING_ITEM_END,
  SPARRING_KEYS,
  STRATEGY_FIELDS,
  emptyStrategyValues,
  selectSparringTargets,
  sparringBeginLine,
  type SparringKey,
  type SparringSectionId,
} from "@meguru/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderStrategyPage, strategyOf } from "./helpers/strategy-page";

const getStrategy = vi.fn();
const putStrategy = vi.fn();
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, getStrategy, putStrategy } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { StrategyPage } = await import("@/apps/threads/pages/strategy");

const SALES = "AIと考える（営業導線）";

function labelOf(key: string): string {
  const f = STRATEGY_FIELDS.find((x) => x.key === key);
  if (!f) throw new Error(key);
  return f.label;
}

/** 目安の文字数を超える長さの、項目ごとの完成版。 */
function proposalOf(key: string): string {
  return `${key}の完成版。` + "具体的な場面と気持ちを書いた文。".repeat(8);
}

/** 項目ごとの完成版を、決まった形で並べたAIの答え。 */
function answerOf(entries: [string, string][]): string {
  return [
    "質問へのお答え、ありがとうございました。完成版です。",
    ...entries.flatMap(([name, text]) => ["", sparringBeginLine(name), text, SPARRING_ITEM_END]),
    "",
    "ほかに直したい項目があれば教えてください。",
  ].join("\n");
}

const fullAnswer = () => answerOf(SPARRING_KEYS.map((k) => [labelOf(k), proposalOf(k)]));

/** 空の課題で、その区分の相談する項目の数。 */
const countOf = (section: SparringSectionId) =>
  selectSparringTargets(emptyStrategyValues(), { sections: [section], onlyIncomplete: true }).length;

/**
 * 区分の見出しの横の「AIと考える」を押し、ポップアップを返す。
 * @param name - 入口のボタンの名前（例：AIと考える（営業導線））
 */
async function openPanel(user: { click: (el: Element) => Promise<void> } = userEvent, name = SALES) {
  await screen.findByRole("heading", { name: "営業導線設計" });
  await user.click(screen.getByRole("button", { name }));
  return within(await screen.findByRole("dialog", { name }));
}

/** 「反映する」（スマートフォンの右上と、パソコンの下の2つがある。どちらも同じ）。 */
const applyButton = (panel: ReturnType<typeof within>) => panel.getAllByRole("button", { name: "反映する" })[0]!;

async function paste(box: HTMLElement, text: string) {
  await userEvent.click(box);
  await userEvent.paste(text);
}

function fieldBox(key: string) {
  const el = document.getElementById(`field-${key}`);
  if (!el) throw new Error(`field-${key} がない`);
  return within(el);
}

describe("US1：区分ごとに相談し、一括で反映する", () => {
  beforeEach(() => {
    getStrategy.mockReset();
    putStrategy.mockReset();
  });

  it("直せる人には、区分の見出しの横に「AIと考える」を出す。下書きには出さない。上のカードには「全体をAIと整理する」だけ", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    await screen.findByRole("heading", { name: "営業導線設計" });
    for (const chip of ["目的", "営業導線", "アカウント", "集客導線", "人柄", "その他"]) {
      expect(screen.getByRole("button", { name: `AIと考える（${chip}）` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "AIと考える（下書き）" })).toBeNull();
    expect(screen.queryByRole("button", { name: "AIと壁打ちして埋める" })).toBeNull();
    expect(screen.getByRole("button", { name: "全体をAIと整理する" })).toBeInTheDocument();
  });

  it("見せてもらっている人・読むだけには出さない（FR-001）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ canEdit: false }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    await screen.findByRole("heading", { name: "営業導線設計" });
    expect(screen.queryByRole("button", { name: SALES })).not.toBeInTheDocument();
  });

  it("押すとポップアップが開き、手順・コピー・貼る欄が出る。区分のチップは出さない。✕で閉じる", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    expect(panel.getByText("AIの質問に答える")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "プロンプトをコピーする" })).toBeInTheDocument();
    expect(panel.getByLabelText("AIの答えを貼り付ける")).toBeInTheDocument();
    expect(panel.queryByRole("group", { name: "相談する区分" })).toBeNull();
    expect(panel.getByText(`${countOf("sales")}項目を相談します`)).toBeInTheDocument();
    await userEvent.click(panel.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog", { name: SALES })).not.toBeInTheDocument();
  });

  it("コピーすると、その区分の項目だけのプロンプトが入り、ボタンの下に結果が出る（US1-2・US1-3）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel(user);
    await user.click(panel.getByRole("button", { name: "プロンプトをコピーする" }));
    const copied = writeText.mock.calls.at(-1)?.[0] ?? "";
    expect(copied).toContain(`下の${countOf("sales")}項目を、一緒に考えて完成させてください`);
    expect(copied).toContain(sparringBeginLine(labelOf("realWorries")));
    // ほかの区分の項目は、相談の対象に入らない
    expect(copied).not.toContain(sparringBeginLine(labelOf("purposeOrigin")));
    expect(panel.getByText("コピーしました。ChatGPTやClaudeに貼り付けて送ってください")).toBeInTheDocument();
  });

  it("コピーできなければ、プロンプトを選べる形で出す（Edge Cases）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel(user);
    await user.click(panel.getByRole("button", { name: "プロンプトをコピーする" }));
    expect(panel.getByText("コピーできませんでした。全体を選んでコピーしてください")).toBeInTheDocument();
    expect((panel.getByLabelText("プロンプト") as HTMLTextAreaElement).value).toContain("一緒に考えて完成させてください");
  });

  it("答えを貼ってまとめて反映すると、入力欄が置き換わり、保存するまで送らない（SC-001・SC-003、FR-019・FR-020）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    putStrategy.mockImplementation(async (_id: string, body: Record<string, unknown>) => strategyOf({ ...body, version: 2 }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await paste(panel.getByLabelText("AIの答えを貼り付ける"), fullAnswer());
    // 区分の外の項目も、読み取れたものは候補に並ぶ（FR-012）
    const boxes = panel.getAllByRole("checkbox");
    expect(boxes).toHaveLength(21);
    for (const b of boxes) expect(b).toBeChecked();

    await userEvent.click(applyButton(panel));
    expect(screen.queryByRole("dialog", { name: SALES })).not.toBeInTheDocument();
    for (const k of SPARRING_KEYS) {
      expect(fieldBox(k).getByLabelText(labelOf(k))).toHaveValue(proposalOf(k));
    }
    expect(putStrategy).not.toHaveBeenCalled();
    expect(screen.getByTestId("progress-done")).toHaveTextContent("15");

    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(putStrategy).toHaveBeenCalledTimes(1);
    expect(putStrategy.mock.calls[0]?.[1]).toMatchObject({ realWorries: proposalOf("realWorries") });
  });

  it("貼った答えがあるまま閉じると、破棄してよいか確かめる", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await paste(panel.getByLabelText("AIの答えを貼り付ける"), fullAnswer());
    await userEvent.click(panel.getByRole("button", { name: "閉じる" }));
    expect(await screen.findByText("貼り付けたAIの答えがあります。破棄しますか？")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "破棄して閉じる" }));
    expect(screen.queryByRole("dialog", { name: SALES })).not.toBeInTheDocument();
  });
});

describe("US2：区分の中で、未入力と短めの項目だけにする", () => {
  beforeEach(() => {
    getStrategy.mockReset();
    putStrategy.mockReset();
  });

  it("はじめはスイッチがオンで、その区分の相談する項目の数が出る（FR-003）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel(userEvent, "AIと考える（目的）");
    expect(panel.getByRole("switch", { name: "未入力と短めの項目だけにする" })).toBeChecked();
    expect(panel.getByText(`${countOf("purpose")}項目を相談します`)).toBeInTheDocument();
  });

  it("十分な項目は質問の対象から外れ、ほかの項目として文脈に入る。スイッチをオフにすると戻る（FR-004）", async () => {
    const done = proposalOf("finalAction");
    getStrategy.mockResolvedValue(strategyOf({ finalAction: done }));
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel(user);
    expect(panel.getByText(`${countOf("sales") - 1}項目を相談します`)).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "プロンプトをコピーする" }));
    const copied = writeText.mock.calls.at(-1)?.[0] ?? "";
    expect(copied).not.toContain(sparringBeginLine(labelOf("finalAction")));
    expect(copied).toContain(`- ${labelOf("finalAction")}: ${done}`);

    await user.click(panel.getByRole("switch", { name: "未入力と短めの項目だけにする" }));
    expect(panel.getByText(`${countOf("sales")}項目を相談します`)).toBeInTheDocument();
  });

  it("相談する項目がなければ、その旨を出してコピーできない（FR-005）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ toneNotes: proposalOf("toneNotes") }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel(userEvent, "AIと考える（人柄）");
    expect(panel.getByText("この区分には、相談する項目がありません")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "プロンプトをコピーする" })).toBeDisabled();
  });

  it("スイッチを変えると、前のコピーの結果が消える（プロンプトが変わるため）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel(user);
    await user.click(panel.getByRole("button", { name: "プロンプトをコピーする" }));
    expect(panel.getByLabelText("プロンプト")).toBeInTheDocument();
    await user.click(panel.getByRole("switch", { name: "未入力と短めの項目だけにする" }));
    expect(panel.queryByLabelText("プロンプト")).not.toBeInTheDocument();
  });

  it("閉じて開き直すと、スイッチがはじめに戻る", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    let panel = await openPanel();
    await userEvent.click(panel.getByRole("switch", { name: "未入力と短めの項目だけにする" }));
    await userEvent.click(panel.getByRole("button", { name: "閉じる" }));
    panel = await openPanel();
    expect(panel.getByRole("switch", { name: "未入力と短めの項目だけにする" })).toBeChecked();
  });
});

describe("US3：反映する前に、案を見比べて選ぶ", () => {
  beforeEach(() => {
    getStrategy.mockReset();
    putStrategy.mockReset();
  });

  const entries = (keys: SparringKey[]) => keys.map((k): [string, string] => [labelOf(k), proposalOf(k)]);

  it("書いてある項目は選ばれず、空の項目は選ばれる。同じ案は「今と同じ」（FR-016）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ realWorries: "お金が残らない", antiPersona: proposalOf("antiPersona") }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await paste(panel.getByLabelText("AIの答えを貼り付ける"), answerOf(entries(["realWorries", "antiPersona", "finalAction"])));
    expect(panel.getByRole("checkbox", { name: labelOf("finalAction") })).toBeChecked();
    expect(panel.getByRole("checkbox", { name: labelOf("realWorries") })).not.toBeChecked();
    expect(panel.getByRole("checkbox", { name: labelOf("antiPersona") })).not.toBeChecked();
    expect(panel.getByText("今と同じ")).toBeInTheDocument();
    expect(panel.getByText("3件中1件を選んでいます")).toBeInTheDocument();
  });

  it("すべて選ぶ・すべて外す。0件なら反映できない（FR-017・FR-019）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ realWorries: "お金が残らない" }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await paste(panel.getByLabelText("AIの答えを貼り付ける"), answerOf(entries(["realWorries", "finalAction"])));
    await userEvent.click(panel.getByRole("button", { name: "すべて選ぶ" }));
    expect(panel.getByText("2件中2件を選んでいます")).toBeInTheDocument();
    for (const b of panel.getAllByRole("checkbox")) expect(b).toBeChecked();
    await userEvent.click(panel.getByRole("button", { name: "すべて外す" }));
    expect(panel.getByText("2件中0件を選んでいます")).toBeInTheDocument();
    expect(applyButton(panel)).toBeDisabled();
  });

  it("上限を超える案に印を出し、反映はできるが保存できない（FR-018）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await paste(panel.getByLabelText("AIの答えを貼り付ける"), answerOf([[labelOf("finalAction"), "あ".repeat(2001)]]));
    expect(panel.getByText("2000文字を超えています。反映した後に短くしてください")).toBeInTheDocument();
    await userEvent.click(applyButton(panel));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("選ばなかった項目は変わらない（SC-004）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ realWorries: "お金が残らない" }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await paste(panel.getByLabelText("AIの答えを貼り付ける"), answerOf(entries(["realWorries", "finalAction"])));
    await userEvent.click(applyButton(panel));
    expect(fieldBox("realWorries").getByLabelText(labelOf("realWorries"))).toHaveValue("お金が残らない");
    expect(fieldBox("finalAction").getByLabelText(labelOf("finalAction"))).toHaveValue(proposalOf("finalAction"));
  });
});

describe("US4：答えの形が崩れていても、読めた分だけ使う", () => {
  beforeEach(() => {
    getStrategy.mockReset();
    putStrategy.mockReset();
  });

  it("目印がなければ、出し直しの案内を出し、候補を出さない（FR-014、SC-005）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await paste(panel.getByLabelText("AIの答えを貼り付ける"), "## ターゲットの本音の悩み\nお金が残らない");
    expect(
      panel.getByText(
        "項目ごとの完成版が見つかりませんでした。AIに『決まった形で完成版を出してください』と送り、出た答えを貼ってください",
      ),
    ).toBeInTheDocument();
    expect(panel.queryAllByRole("checkbox")).toHaveLength(0);
    expect(applyButton(panel)).toBeDisabled();
  });

  it("対象ではない名前を知らせ、範囲の外の項目も候補にする（FR-012・FR-013）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await paste(
      panel.getByLabelText("AIの答えを貼り付ける"),
      answerOf([
        ["近い人間性", "丁寧・温かい"],
        ["好きな食べ物", "カレー"],
        [labelOf("realWorries"), proposalOf("realWorries")],
      ]),
    );
    expect(panel.getByText("読み取れなかった項目：近い人間性、好きな食べ物")).toBeInTheDocument();
    expect(panel.getByRole("checkbox", { name: labelOf("realWorries") })).toBeInTheDocument();
  });
});
