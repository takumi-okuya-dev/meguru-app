// US3：AIと深掘りする（specs/014-strategy-guidance FR-030〜FR-035・FR-070、SC-004・SC-005・SC-008）
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FINAL_BEGIN, FINAL_END } from "@threads-grower/shared";
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

async function field(key: string) {
  await screen.findByRole("heading", { name: "営業導線設計" });
  const el = document.getElementById(`field-${key}`);
  if (!el) throw new Error(`field-${key} がない`);
  return within(el);
}

/** 貼り付け欄に文を入れる（改行を含むので paste を使う）。 */
async function paste(box: HTMLElement, text: string) {
  await userEvent.click(box);
  await userEvent.paste(text);
}

describe("AIと深掘りする", () => {
  beforeEach(() => {
    getStrategy.mockReset();
    putStrategy.mockReset();
  });

  it("開くと手順・コピー・貼り付け欄が出て、同時に開くのは1項目だけ（FR-030・FR-031）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const target = await field("targetPersona");
    await userEvent.click(target.getByRole("button", { name: "この項目をAIと深掘りする" }));
    expect(target.getByRole("button", { name: "プロンプトをコピーする" })).toBeInTheDocument();
    expect(target.getByLabelText("AIの答えを貼り付ける")).toBeInTheDocument();
    expect(target.getByText(/ChatGPTやClaudeに貼り付けて送り、AIの質問に答える/)).toBeInTheDocument();

    const worries = await field("realWorries");
    await userEvent.click(worries.getByRole("button", { name: "この項目をAIと深掘りする" }));
    expect(worries.getByLabelText("AIの答えを貼り付ける")).toBeInTheDocument();
    expect(target.queryByLabelText("AIの答えを貼り付ける")).not.toBeInTheDocument();
  });

  it("コピーすると、その項目のプロンプトがクリップボードに入る（未保存の入力を含む）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("targetPersona");
    await user.type(f.getByRole("textbox"), "20代会社員");
    await user.click(f.getByRole("button", { name: "この項目をAIと深掘りする" }));
    await user.click(f.getByRole("button", { name: "プロンプトをコピーする" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]![0];
    expect(copied).toContain("「どんな人に投稿を届けたいか」");
    expect(copied).toContain("■今の私の答え\n20代会社員");
    expect(f.getByText("コピーしました")).toBeInTheDocument();
  });

  it("コピーできなければ、プロンプトを選べる形で出す", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("finalAction");
    await user.click(f.getByRole("button", { name: "この項目をAIと深掘りする" }));
    await user.click(f.getByRole("button", { name: "プロンプトをコピーする" }));
    expect(f.getByText("コピーできませんでした。全体を選んでコピーしてください")).toBeInTheDocument();
    expect((f.getByLabelText("プロンプト") as HTMLTextAreaElement).value).toContain("「最終的に読者に取ってほしい行動」");
  });

  it("目印の内側を反映すると入力欄が置き換わり、未保存の変更になり、変更を破棄で戻る（FR-033・FR-034、SC-004・SC-005）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ realWorries: "将来が不安" }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("realWorries");
    await userEvent.click(f.getByRole("button", { name: "この項目をAIと深掘りする" }));
    await paste(f.getByLabelText("AIの答えを貼り付ける"), `まとめました。\n${FINAL_BEGIN}\n会社と家の往復で出会いが減った\n${FINAL_END}\nどうですか？`);
    expect(f.getByText(/目印「【完成版ここから】」の内側/)).toBeInTheDocument();
    await userEvent.click(f.getByRole("button", { name: "この内容を反映する" }));
    expect(f.getByLabelText("ターゲットの本音の悩み")).toHaveValue("会社と家の往復で出会いが減った");
    expect(f.queryByLabelText("AIの答えを貼り付ける")).not.toBeInTheDocument();
    expect(putStrategy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "その他の操作" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "変更を破棄" }));
    expect(f.getByLabelText("ターゲットの本音の悩み")).toHaveValue("将来が不安");
  });

  it("目印がなければ全体を反映する内容として示し、空なら押せない（FR-033・FR-034）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("finalAction");
    await userEvent.click(f.getByRole("button", { name: "この項目をAIと深掘りする" }));
    expect(f.getByRole("button", { name: "この内容を反映する" })).toBeDisabled();
    await paste(f.getByLabelText("AIの答えを貼り付ける"), "  公式LINEに登録してもらう  ");
    expect(f.getByText("目印が見つからないので、貼り付けた文の全体を反映します")).toBeInTheDocument();
    await userEvent.click(f.getByRole("button", { name: "この内容を反映する" }));
    expect(f.getByLabelText("最終的に読者に取ってほしい行動")).toHaveValue("公式LINEに登録してもらう");
  });

  it("上限を超える内容は注意を出し、反映はできるが保存できない（FR-035）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("finalAction");
    await userEvent.click(f.getByRole("button", { name: "この項目をAIと深掘りする" }));
    await paste(f.getByLabelText("AIの答えを貼り付ける"), "あ".repeat(2001));
    expect(f.getByText("2000文字を超えています。反映した後に短くしてください")).toBeInTheDocument();
    await userEvent.click(f.getByRole("button", { name: "この内容を反映する" }));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("見せてもらっている人には「AIと深掘りする」を出さない（FR-070、SC-008）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ canEdit: false }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    await field("finalAction");
    expect(screen.queryByRole("button", { name: "この項目をAIと深掘りする" })).not.toBeInTheDocument();
  });

  it("近い人間性と下書きには「AIと深掘りする」がない（FR-030）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    for (const key of ["tonePreset", "profileBioDraft"]) {
      expect((await field(key)).queryByRole("button", { name: /AIと/ }), key).not.toBeInTheDocument();
    }
  });

  it("目的の区分に案内の文、活動の軸に任意の印が出る（US5-1）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    await field("purposeOrigin");
    expect(screen.getByText(/何のために発信するかを先に決めると、ほかの項目が書きやすくなります/)).toBeInTheDocument();
    expect((await field("activityAxis")).getByText("任意")).toBeInTheDocument();
  });

  it("活動の軸：5問がすべて空なら「5問からAIと整理する」は押せず、案内が出る（US5-4）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("activityAxis");
    expect(f.getByRole("button", { name: "5問からAIと整理する" })).toBeDisabled();
    expect(f.getByText("先にQ1〜Q5のどれかに答えてください")).toBeInTheDocument();
  });

  it("活動の軸：5問の答えから活動の軸のプロンプトをコピーし、貼り付けて反映できる（US5-3）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ purposeOrigin: "上京して寂しかった" }));
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("activityAxis");
    await user.click(f.getByRole("button", { name: "5問からAIと整理する" }));
    await user.click(f.getByRole("button", { name: "プロンプトをコピーする" }));
    expect(writeText.mock.calls.at(-1)![0]).toContain("「活動の軸」の案を3つ");
    await user.click(f.getByLabelText("AIの答えを貼り付ける"));
    await user.paste(`${FINAL_BEGIN}\nひとりにしない\n${FINAL_END}`);
    await user.click(f.getByRole("button", { name: "この内容を反映する" }));
    expect(f.getByLabelText("活動の軸")).toHaveValue("ひとりにしない");
  });
});

describe("深掘りの貼り付けを捨てる前の確認（PR #17 のCodexレビュー6回目）", () => {
  const paste = async (area: HTMLElement, text: string) => {
    await userEvent.click(area);
    await userEvent.paste(text);
  };

  it("貼り付けたまま「閉じる」を押すと、破棄してよいかを確かめる。破棄すると閉じる", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("realWorries");
    await userEvent.click(f.getByRole("button", { name: "この項目をAIと深掘りする" }));
    await paste(f.getByLabelText("AIの答えを貼り付ける"), "AIの答え");
    await userEvent.click(f.getByRole("button", { name: "閉じる" }));
    expect(await screen.findByText("貼り付けたAIの答えがあります。破棄しますか？")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "編集に戻る" }));
    expect(f.getByLabelText("AIの答えを貼り付ける")).toHaveValue("AIの答え");
    await userEvent.click(f.getByRole("button", { name: "閉じる" }));
    await userEvent.click(await screen.findByRole("button", { name: "破棄して閉じる" }));
    expect(f.queryByLabelText("AIの答えを貼り付ける")).not.toBeInTheDocument();
  });

  it("貼り付けたまま別の項目の深掘りを開こうとすると、破棄してよいかを確かめる", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("realWorries");
    await userEvent.click(f.getByRole("button", { name: "この項目をAIと深掘りする" }));
    await paste(f.getByLabelText("AIの答えを貼り付ける"), "AIの答え");
    const other = await field("targetPersona");
    await userEvent.click(other.getByRole("button", { name: "この項目をAIと深掘りする" }));
    expect(await screen.findByText("貼り付けたAIの答えがあります。破棄しますか？")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "破棄して閉じる" }));
    expect(other.getByLabelText("AIの答えを貼り付ける")).toHaveValue("");
    expect(f.queryByLabelText("AIの答えを貼り付ける")).not.toBeInTheDocument();
  });

  it("貼り付けたまま画面を移ろうとすると、未保存の確認が出る", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("realWorries");
    await userEvent.click(f.getByRole("button", { name: "この項目をAIと深掘りする" }));
    await paste(f.getByLabelText("AIの答えを貼り付ける"), "AIの答え");
    await userEvent.click(screen.getByRole("link", { name: "ホームへ" }));
    expect(await screen.findByText("保存していない変更があります")).toBeInTheDocument();
  });
});
