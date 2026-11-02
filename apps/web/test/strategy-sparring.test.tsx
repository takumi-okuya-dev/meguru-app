// AIと壁打ちして課題を埋める（specs/018-strategy-ai-sparring US1〜US4、contracts/ui-routes.md、SC-001〜SC-005）
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  SPARRING_ITEM_END,
  SPARRING_KEYS,
  STRATEGY_FIELDS,
  sparringBeginLine,
  type SparringKey,
} from "@threads-grower/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderStrategyPage, strategyOf } from "./helpers/strategy-page";

const getStrategy = vi.fn();
const putStrategy = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, getStrategy, putStrategy } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { StrategyPage } = await import("@/pages/strategy");

const OPEN = "AIと壁打ちして埋める";

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

async function openPanel(user: { click: (el: Element) => Promise<void> } = userEvent) {
  await screen.findByRole("heading", { name: "営業導線設計" });
  await user.click(screen.getByRole("button", { name: OPEN }));
  return within(screen.getByRole("region", { name: "AIと壁打ち" }));
}

async function paste(box: HTMLElement, text: string) {
  await userEvent.click(box);
  await userEvent.paste(text);
}

function fieldBox(key: string) {
  const el = document.getElementById(`field-${key}`);
  if (!el) throw new Error(`field-${key} がない`);
  return within(el);
}

describe("US1：まとめて壁打ちし、一括で反映する", () => {
  beforeEach(() => {
    getStrategy.mockReset();
    putStrategy.mockReset();
  });

  it("直せる人には「全体をAIと整理する」と並べて出し、見せてもらっている人には出さない（FR-001）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const open = await screen.findByRole("button", { name: OPEN });
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "全体をAIと整理する" })).toBeInTheDocument();
  });

  it("見せてもらっている人・読むだけには出さない（FR-001）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ canEdit: false }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    await screen.findByRole("heading", { name: "営業導線設計" });
    expect(screen.queryByRole("button", { name: OPEN })).not.toBeInTheDocument();
  });

  it("押すと開き、ボタンの名前は変わらない。もう一度押すと閉じる（FR-002、docs/ui-design.md §6）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    const toggle = screen.getByRole("button", { name: OPEN });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel.getByText("ChatGPTやClaudeに貼り付けて送り、AIの質問に答える")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "プロンプトをコピーする" })).toBeInTheDocument();
    expect(panel.getByLabelText("AIの答えを貼り付ける")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByRole("region", { name: "AIと壁打ち" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: OPEN })).toHaveAttribute("aria-expanded", "false");
  });

  it("コピーすると、壁打ちのプロンプトが入り、ボタンの下に結果が出る（US1-2・US1-3）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel(user);
    await user.click(panel.getByRole("button", { name: "プロンプトをコピーする" }));
    const copied = writeText.mock.calls.at(-1)?.[0] ?? "";
    expect(copied).toContain("下の21項目を、一緒に考えて完成させてください");
    expect(copied).toContain(sparringBeginLine(labelOf("realWorries")));
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

  it("21項目の答えを貼ってまとめて反映すると、入力欄が置き換わり、保存するまで送らない（SC-001・SC-003、FR-019・FR-020）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    putStrategy.mockImplementation(async (_id: string, body: Record<string, unknown>) => strategyOf({ ...body, version: 2 }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await paste(panel.getByLabelText("AIの答えを貼り付ける"), fullAnswer());
    const boxes = panel.getAllByRole("checkbox");
    expect(boxes).toHaveLength(21);
    for (const b of boxes) expect(b).toBeChecked();

    await userEvent.click(panel.getByRole("button", { name: "選んだ項目を反映する" }));
    expect(screen.queryByRole("region", { name: "AIと壁打ち" })).not.toBeInTheDocument();
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
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("貼り付けたAIの答えがあります。破棄しますか？")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "破棄して閉じる" }));
    expect(screen.queryByRole("region", { name: "AIと壁打ち" })).not.toBeInTheDocument();
  });

  it("項目の「AIと深掘り」と同時に開け、片方を閉じてももう片方は開いたまま（Edge Cases）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    await openPanel();
    const f = fieldBox("realWorries");
    await userEvent.click(f.getByRole("button", { name: "AIと深掘り" }));
    expect(f.getByLabelText("AIの答えを貼り付ける")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "AIと壁打ち" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: OPEN }));
    expect(f.getByLabelText("AIの答えを貼り付ける")).toBeInTheDocument();
  });
});

describe("US2：範囲を絞って壁打ちする", () => {
  beforeEach(() => {
    getStrategy.mockReset();
    putStrategy.mockReset();
  });

  it("はじめはすべての区分とスイッチがオンで、相談する項目の数が出る（FR-003）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    const group = within(panel.getByRole("group", { name: "相談する区分" }));
    for (const name of ["目的", "営業導線", "アカウント", "集客導線", "人柄", "その他"]) {
      expect(group.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
    }
    expect(panel.getByRole("switch", { name: "未入力と短めの項目だけにする" })).toBeChecked();
    expect(panel.getByText("21項目を相談します")).toBeInTheDocument();
  });

  it("十分な項目は質問の対象から外れ、ほかの項目として文脈に入る。スイッチをオフにすると戻る（FR-004）", async () => {
    const done = proposalOf("finalAction");
    getStrategy.mockResolvedValue(strategyOf({ finalAction: done }));
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel(user);
    expect(panel.getByText("20項目を相談します")).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "プロンプトをコピーする" }));
    const copied = writeText.mock.calls.at(-1)?.[0] ?? "";
    expect(copied).not.toContain(sparringBeginLine(labelOf("finalAction")));
    expect(copied).toContain(`- ${labelOf("finalAction")}: ${done}`);

    await user.click(panel.getByRole("switch", { name: "未入力と短めの項目だけにする" }));
    expect(panel.getByText("21項目を相談します")).toBeInTheDocument();
  });

  it("区分を1つにすると、その区分の数になる。すべて外すと押せない（FR-005）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    const group = within(panel.getByRole("group", { name: "相談する区分" }));
    for (const name of ["目的", "営業導線", "アカウント", "集客導線", "その他"]) {
      await userEvent.click(group.getByRole("button", { name }));
    }
    expect(group.getByRole("button", { name: "人柄" })).toHaveAttribute("aria-pressed", "true");
    expect(panel.getByText("1項目を相談します")).toBeInTheDocument();
    await userEvent.click(group.getByRole("button", { name: "人柄" }));
    expect(panel.getByText("この範囲には、相談する項目がありません")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "プロンプトをコピーする" })).toBeDisabled();
    // 範囲を変えても、ボタンの名前は変わらない
    expect(screen.getByRole("button", { name: OPEN })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全体をAIと整理する" })).toBeInTheDocument();
  });

  it("閉じて開き直すと、範囲がはじめに戻る", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    let panel = await openPanel();
    await userEvent.click(panel.getByRole("switch", { name: "未入力と短めの項目だけにする" }));
    await userEvent.click(within(panel.getByRole("group", { name: "相談する区分" })).getByRole("button", { name: "目的" }));
    await userEvent.click(screen.getByRole("button", { name: OPEN }));
    await userEvent.click(screen.getByRole("button", { name: OPEN }));
    panel = within(screen.getByRole("region", { name: "AIと壁打ち" }));
    expect(panel.getByRole("switch", { name: "未入力と短めの項目だけにする" })).toBeChecked();
    expect(panel.getByText("21項目を相談します")).toBeInTheDocument();
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
    expect(panel.getByRole("button", { name: "選んだ項目を反映する" })).toBeDisabled();
  });

  it("上限を超える案に印を出し、反映はできるが保存できない（FR-018）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await paste(panel.getByLabelText("AIの答えを貼り付ける"), answerOf([[labelOf("finalAction"), "あ".repeat(2001)]]));
    expect(panel.getByText("2000文字を超えています。反映した後に短くしてください")).toBeInTheDocument();
    await userEvent.click(panel.getByRole("button", { name: "選んだ項目を反映する" }));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("選ばなかった項目は変わらない（SC-004）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ realWorries: "お金が残らない" }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await paste(panel.getByLabelText("AIの答えを貼り付ける"), answerOf(entries(["realWorries", "finalAction"])));
    await userEvent.click(panel.getByRole("button", { name: "選んだ項目を反映する" }));
    expect(fieldBox("realWorries").getByLabelText(labelOf("realWorries"))).toHaveValue("お金が残らない");
    expect(fieldBox("finalAction").getByLabelText(labelOf("finalAction"))).toHaveValue(proposalOf("finalAction"));
  });

  it("貼ったあとに入力欄を直すと、候補の「今」も変わる（research.md R6）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ realWorries: "お金が残らない" }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await paste(panel.getByLabelText("AIの答えを貼り付ける"), answerOf(entries(["realWorries"])));
    await userEvent.type(fieldBox("realWorries").getByLabelText(labelOf("realWorries")), "。貯金もない");
    expect(panel.getByText("お金が残らない。貯金もない")).toBeInTheDocument();
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
    expect(panel.getByRole("button", { name: "選んだ項目を反映する" })).toBeDisabled();
  });

  it("対象ではない名前を知らせ、範囲の外の項目も候補にする（FR-012・FR-013）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const panel = await openPanel();
    await userEvent.click(within(panel.getByRole("group", { name: "相談する区分" })).getByRole("button", { name: "営業導線" }));
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
