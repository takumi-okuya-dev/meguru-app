// US1：考えるヒント（specs/014-strategy-guidance FR-001〜FR-004、contracts/ui-routes.md「課題」）
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderStrategyPage, strategyOf } from "./helpers/strategy-page";

const getStrategy = vi.fn();
const putStrategy = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api } };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, getStrategy, putStrategy } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { StrategyPage } = await import("@/apps/threads/pages/strategy");

/** 項目（id="field-<key>"）の中を探す。 */
async function field(key: string) {
  await screen.findByRole("heading", { name: "営業導線設計" });
  const el = document.getElementById(`field-${key}`);
  if (!el) throw new Error(`field-${key} がない`);
  return within(el);
}

describe("考えるヒント", () => {
  beforeEach(() => {
    getStrategy.mockReset();
    putStrategy.mockReset();
  });

  it("初めは閉じていて、押すとコツ・悪い例・良い例・3つの問いが出て、もう一度で閉じる（FR-001・FR-002）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("targetPersona");
    const button = f.getByRole("button", { name: /考えるヒント/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(f.queryByText("20代会社員")).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    // 開いても文言は変えない（ボタンの幅が変わって、横のボタンが動かないように）
    expect(button).toHaveTextContent(/^考えるヒント$/);
    expect(f.getByText(/年齢・職業で終わらせず/)).toBeInTheDocument();
    expect(f.getByText("20代会社員")).toBeInTheDocument();
    expect(f.getByText(/28歳前後の会社員。仕事は嫌いではないけれど/)).toBeInTheDocument();
    expect(f.getByText("もっとこんな内容も足してみたら？")).toBeInTheDocument();
    expect(f.getByText("平日の終わり方と、休日の過ごし方")).toBeInTheDocument();
    expect(f.getByText("こんな場合はどうだろう？")).toBeInTheDocument();
    expect(f.getByText("もっと良くするなら、ここを考えてみて")).toBeInTheDocument();

    await userEvent.click(button);
    expect(f.queryByText("20代会社員")).not.toBeInTheDocument();
  });

  it("目的の5問と近い人間性にもヒントがあり、活動の軸と下書きにはない（SC-001）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    for (const key of ["purposeOrigin", "purposeStance", "tonePreset", "successMetrics"]) {
      expect((await field(key)).getByRole("button", { name: /考えるヒント/ }), key).toBeInTheDocument();
    }
    for (const key of ["activityAxis", "profileBioDraft"]) {
      expect((await field(key)).queryByRole("button", { name: /考えるヒント/ }), key).not.toBeInTheDocument();
    }
  });

  it("発信テーマの掛け合わせに★特に大事と考え方の説明がいつも出る（FR-003）", async () => {
    getStrategy.mockResolvedValue(strategyOf());
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("contentThemeMix");
    expect(f.getByText("★ 特に大事")).toBeInTheDocument();
    expect(f.getByText(/売りたいもの × ターゲットが共感するテーマ/)).toBeInTheDocument();
  });

  it("見せてもらっている人（直せない人）にもヒントが出る（FR-004）", async () => {
    getStrategy.mockResolvedValue(strategyOf({ canEdit: false }));
    renderStrategyPage(StrategyPage, UnsavedChangesProvider);
    const f = await field("finalAction");
    await userEvent.click(f.getByRole("button", { name: /考えるヒント/ }));
    expect(f.getByText("ファンになってほしい")).toBeInTheDocument();
  });
});
