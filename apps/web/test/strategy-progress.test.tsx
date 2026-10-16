// US2：自動チェックと進み具合（specs/014-strategy-guidance FR-012〜FR-018、SC-002・SC-003）
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HINTED_KEYS, STRATEGY_HINTS, emptyStrategyValues } from "@threads-grower/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

type ObserverCallback = (entries: { target: Element; isIntersecting: boolean; boundingClientRect: { top: number } }[]) => void;
let observerCallbacks: ObserverCallback[] = [];

beforeEach(() => {
  getStrategy.mockReset();
  putStrategy.mockReset();
  observerCallbacks = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: ObserverCallback) {
        observerCallbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function field(key: string) {
  await screen.findByRole("heading", { name: "営業導線設計" });
  const el = document.getElementById(`field-${key}`);
  if (!el) throw new Error(`field-${key} がない`);
  return within(el);
}

function progress() {
  return within(screen.getByRole("region", { name: "進み具合" }));
}

describe("自動チェックと進み具合", () => {
  it("入力のたびに、印・上の数・短めの一言が変わる（保存しない。FR-012〜FR-014）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("targetPersona");
    expect(f.getByText("未入力")).toBeInTheDocument();
    expect(progress().getByText("完了")).toBeInTheDocument();
    expect(progress().getByTestId("progress-done")).toHaveTextContent("0");

    await userEvent.type(f.getByRole("textbox"), "20代会社員");
    expect(f.getByText("短め")).toBeInTheDocument();
    expect(f.getByText(/出来事・気持ち・具体的な場面を1つ足すと/)).toBeInTheDocument();
    expect(progress().getByTestId("progress-review")).toHaveTextContent("1");

    await userEvent.type(f.getByRole("textbox"), "前後。仕事は嫌いではないけれど、30歳が近づいてきて、このままでいいのかなと少し焦っている人");
    expect(f.getByText("十分")).toBeInTheDocument();
    expect(progress().getByTestId("progress-done")).toHaveTextContent("1");
    expect(progress().getByTestId("progress-review")).toHaveTextContent("0");
    expect(putStrategy).not.toHaveBeenCalled();
  });

  it("下書きと活動の軸には印を出さない（FR-016）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    for (const key of ["activityAxis", "profileBioDraft"]) {
      const f = await field(key);
      expect(f.queryByText("未入力"), key).not.toBeInTheDocument();
    }
  });

  it("次におすすめを押すと、その項目の入力欄にカーソルが入る（FR-015、SC-003）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    await field("purposeOrigin");
    const next = progress().getByRole("button", { name: /次におすすめ/ });
    expect(next).toHaveTextContent("Q1：なぜ、この活動を始めようと思いましたか？");
    await userEvent.click(next);
    expect(document.activeElement).toBe(document.getElementById("strategy-purposeOrigin"));
  });

  it("すべて十分なら「すべての項目が十分に書けています」（FR-015）", async () => {
    const values = emptyStrategyValues();
    for (const k of HINTED_KEYS) {
      if (k === "tonePreset") values.tonePreset = "formal";
      else values[k] = "あ".repeat(STRATEGY_HINTS[k].minChars ?? 1);
    }
    getStrategy.mockResolvedValue(strategyOf(values));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    await field("finalAction");
    expect(progress().getByText("すべての項目が十分に書けています")).toBeInTheDocument();
    expect(progress().queryByRole("button", { name: /次におすすめ/ })).not.toBeInTheDocument();
  });

  it("固定の区分のチップに区分ごとの数を出し、今の区分を目立たせる（FR-018・FR-019）", async () => {
    const values = emptyStrategyValues();
    values.finalAction = "公式LINEに登録して、月1回の交流会に参加してもらう";
    getStrategy.mockResolvedValue(strategyOf(values));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    await field("finalAction");
    const chips = within(screen.getByRole("navigation", { name: "区分へ移動" }));
    expect(chips.getByRole("button", { name: /^目的0\/5/ })).toBeInTheDocument();
    expect(chips.getByRole("button", { name: /^営業導線1\/5/ })).toBeInTheDocument();
    expect(chips.getByRole("button", { name: /^下書き$/ })).toBeInTheDocument();
    // 完了と要確認の数を先頭に出す（スマートフォンの幅。FR-017）
    expect(chips.getByText("完了1/16")).toBeInTheDocument();
    expect(chips.getByRole("button", { name: /^目的/ })).toHaveAttribute("aria-current", "true");

    const sales = document.getElementById("strategy-sales")!;
    act(() => {
      for (const cb of observerCallbacks) cb([{ target: sales, isIntersecting: true, boundingClientRect: { top: 0 } }]);
    });
    expect(chips.getByRole("button", { name: /^営業導線/ })).toHaveAttribute("aria-current", "true");
    expect(chips.getByRole("button", { name: /^目的/ })).not.toHaveAttribute("aria-current", "true");
  });

  it("「全体をAIと整理する」で、画面の今の値から全体のプロンプトをコピーする（FR-040〜FR-042）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("finalAction");
    await user.type(f.getByRole("textbox"), "公式LINEに登録");
    await user.click(progress().getByRole("button", { name: "全体をAIと整理する" }));
    expect(writeText.mock.calls.at(-1)![0]).toContain("- 最終的に読者に取ってほしい行動: 公式LINEに登録");
    expect(progress().getByText(/項目どうしの重複・矛盾・抜けを質問の形で返してくれます/)).toBeInTheDocument();
  });

  it("見せてもらっている人には「全体をAIと整理する」を出さない（FR-040）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ canEdit: false }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    await field("finalAction");
    expect(progress().queryByRole("button", { name: "全体をAIと整理する" })).not.toBeInTheDocument();
  });
});

describe("ほかの画面から項目へ移る（specs/014 FR-122）", () => {
  it("#field-<key> で開くと、その項目の入力欄にカーソルが入る", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider, "/accounts/a1/strategy#field-targetPersona");
    await screen.findByRole("heading", { name: "営業導線設計" });
    await vi.waitFor(() => expect(document.getElementById("strategy-targetPersona")).toHaveFocus());
  });
});
