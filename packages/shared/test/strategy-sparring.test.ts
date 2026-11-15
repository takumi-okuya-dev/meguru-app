// AIと壁打ちして課題を埋める：対象の項目・範囲の絞り込み・反映の候補（specs/018-strategy-ai-sparring FR-003・FR-004・FR-015〜FR-018、research.md R4）。
import { describe, expect, it } from "vitest";
import { STRATEGY_TEXT_MAX } from "../src/limits";
import { STRATEGY_FIELDS, emptyStrategyValues } from "../src/strategy";
import {
  SPARRING_KEYS,
  SPARRING_SECTION_IDS,
  buildSparringCandidates,
  selectSparringTargets,
  sparringBeginLine,
} from "../src/strategy-sparring";

const ALL = { sections: SPARRING_SECTION_IDS, onlyIncomplete: true };

describe("SPARRING_KEYS", () => {
  it("対象の21項目が課題の画面の順に並び、近い人間性と下書きを含まない", () => {
    expect(SPARRING_KEYS).toHaveLength(21);
    const order = STRATEGY_FIELDS.map((f) => f.key);
    const positions = SPARRING_KEYS.map((k) => order.indexOf(k));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const k of ["tonePreset", "profileBioDraft", "pinnedPostDraft1", "pinnedPostDraft2", "pinnedPostDraft3"]) {
      expect(SPARRING_KEYS as readonly string[]).not.toContain(k);
    }
  });

  it("課題の項目から、下書きと近い人間性を除いたものと一致する（項目を足したときにずれないように）", () => {
    expect([...SPARRING_KEYS]).toEqual(
      STRATEGY_FIELDS.filter((f) => f.section !== "drafts" && f.key !== "tonePreset").map((f) => f.key),
    );
  });

  it("区分は下書きを含まない6つ", () => {
    expect([...SPARRING_SECTION_IDS]).toEqual(["purpose", "sales", "account", "funnel", "tone", "other"]);
  });

  it("始まりの目印の行は【項目：名前】", () => {
    expect(sparringBeginLine("活動の軸")).toBe("【項目：活動の軸】");
  });
});

describe("selectSparringTargets（FR-004）", () => {
  it("空の課題・すべての区分・未入力と短めだけ → 21項目が表示の順", () => {
    expect(selectSparringTargets(emptyStrategyValues(), ALL)).toEqual([...SPARRING_KEYS]);
  });

  it("十分な項目は、未入力と短めだけのときに外れ、オフなら入る。短めは残る", () => {
    const v = emptyStrategyValues();
    v.finalAction = "プロフィールのリンクから、無料の家計相談（30分）に申し込んでもらう。月に5件の申し込みが目標。";
    v.realWorries = "お金";
    const only = selectSparringTargets(v, ALL);
    expect(only).not.toContain("finalAction");
    expect(only).toContain("realWorries");
    expect(selectSparringTargets(v, { ...ALL, onlyIncomplete: false })).toContain("finalAction");
  });

  it("活動の軸は、空なら入り、入力があれば未入力と短めだけのときに外れる", () => {
    const v = emptyStrategyValues();
    expect(selectSparringTargets(v, ALL)).toContain("activityAxis");
    v.activityAxis = "ひとりにしない";
    expect(selectSparringTargets(v, ALL)).not.toContain("activityAxis");
    expect(selectSparringTargets(v, { ...ALL, onlyIncomplete: false })).toContain("activityAxis");
  });

  it("人柄だけなら、その他の文体の条件だけ。区分がなければ空", () => {
    const v = emptyStrategyValues();
    expect(selectSparringTargets(v, { sections: ["tone"], onlyIncomplete: true })).toEqual(["toneNotes"]);
    expect(selectSparringTargets(v, { sections: [], onlyIncomplete: true })).toEqual([]);
  });
});

describe("buildSparringCandidates（FR-015〜FR-018）", () => {
  it("表示の順に並べ、はじめの選択は空の項目だけ。同じ案は「今と同じ」で選ばない", () => {
    const v = emptyStrategyValues();
    v.targetPersona = "30代の共働き夫婦";
    v.realWorries = "お金が貯まらない";
    const c = buildSparringCandidates(
      [
        { key: "realWorries", text: "お金が貯まらない" },
        { key: "purposeSelf", text: "身近な相談役になりたい" },
        { key: "targetPersona", text: "30代の共働き夫婦で、子どもが小さい人" },
      ],
      v,
    );
    expect(c).toMatchObject([
      {
        key: "purposeSelf",
        label: "Q2：この活動を通して、自分自身はどうなりたいですか？",
        current: "",
        proposed: "身近な相談役になりたい",
        selected: true,
        same: false,
        over: false,
      },
      { key: "targetPersona", current: "30代の共働き夫婦", selected: false, same: false },
      { key: "realWorries", selected: false, same: true },
    ]);
  });

  it("空白だけの今の入力は空として扱い、前後の空白の違いは同じとみなす", () => {
    const v = emptyStrategyValues();
    v.finalAction = "  \n ";
    v.realWorries = "同じ文";
    const c = buildSparringCandidates(
      [
        { key: "finalAction", text: "新しい案" },
        { key: "realWorries", text: "\n同じ文  " },
      ],
      v,
    );
    expect(c).toMatchObject([{ selected: true }, { same: true }]);
  });

  it("上限を超える案に印を付ける", () => {
    const c = buildSparringCandidates([{ key: "finalAction", text: "あ".repeat(STRATEGY_TEXT_MAX + 1) }], emptyStrategyValues());
    expect(c).toMatchObject([{ over: true }]);
    const ok = buildSparringCandidates([{ key: "finalAction", text: "あ".repeat(STRATEGY_TEXT_MAX) }], emptyStrategyValues());
    expect(ok).toMatchObject([{ over: false }]);
  });
});
