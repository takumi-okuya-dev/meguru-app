import { describe, expect, it } from "vitest";
import { POLICY_CAUTIONS, findPolicyCautions } from "../src/policy";
import { checkPublishable } from "../src/review";

// specs/004-review-approval contracts/policy-cautions.md の「当たる例」「当たらない例」（SC-008）
const EXAMPLES: Record<string, { hits: string[]; misses: string[] }> = {
  engagement_reward: {
    hits: [
      "この投稿にいいねした人の中から抽選でプレゼント",
      "フォロー＆リポストで3名様に当たる",
      "コメントしてくれた方に無料で配布します",
    ],
    misses: ["いいねが増えるとうれしい", "フォローしてくれている皆さん、いつもありがとう", "誕生日プレゼントを選ぶのが苦手"],
  },
  engagement_gating: {
    hits: ["いいねしたら続きを公開します", "コメントくれた人にだけ資料を送ります", "続きはいいねで解放"],
    misses: ["コメントで感想を聞かせてもらえるとうれしい", "続きはまた明日書きます"],
  },
  guaranteed_results: {
    hits: ["誰でも必ず稼げる方法", "確実に月10万の副収入", "元本保証で安心"],
    misses: ["必ず毎朝コーヒーを飲む", "誰でも最初は初心者", "稼ぐって難しいなと思った話"],
  },
  health_claims: {
    hits: ["このお茶でアトピーが治った", "飲むだけで痩せるサプリ", "薬いらずの体に"],
    misses: ["風邪が治ったので外に出た", "早く寝るようにしたら朝が楽になった", "がんばったら不安が消えた"],
  },
};

describe("規約に注意（specs/004-review-approval FR-038、contracts/policy-cautions.md、SC-008）", () => {
  it("4つの分類があり、契約のとおりの名前と関わる規約を持つ", () => {
    expect(POLICY_CAUTIONS.map((c) => [c.id, c.label])).toEqual([
      ["engagement_reward", "見返りでの反応集め"],
      ["engagement_gating", "反応しないと見られない形"],
      ["guaranteed_results", "収益・成果の断定"],
      ["health_claims", "健康・医療の効果"],
    ]);
    for (const c of POLICY_CAUTIONS) {
      expect(c.policyUrl).toMatch(/^https:\/\/transparency\.meta\.com\//);
      expect(c.suggestion).not.toBe("");
    }
  });

  for (const [id, { hits }] of Object.entries(EXAMPLES)) {
    it.each(hits)(`${id}：「%s」は当たる`, (body) => {
      expect(findPolicyCautions(body).map((h) => h.id)).toContain(id);
    });
  }

  it.each(Object.values(EXAMPLES).flatMap((e) => e.misses))("「%s」はどの分類にも当たらない", (body) => {
    expect(findPolicyCautions(body)).toEqual([]);
  });

  it("全角・半角の揺れでも当たる", () => {
    expect(findPolicyCautions("１００％稼げる").map((h) => h.id)).toEqual(["guaranteed_results"]);
    expect(findPolicyCautions("いいねした人にＤＭで送ります").map((h) => h.id)).toEqual(["engagement_gating"]);
  });

  it("範囲は元の本文の位置で返る", () => {
    const body = "朝の話。このお茶でアトピーが治った";
    const [hit] = findPolicyCautions(body);
    const [start, end] = hit!.ranges[0]!;
    expect(body.slice(start, end)).toBe("アトピーが治った");
  });

  it("checkPublishable に結果が入るが、承認は止めない", () => {
    const r = checkPublishable("誰でも必ず稼げる方法", []);
    expect(r.policyCautions.map((h) => h.id)).toEqual(["guaranteed_results"]);
    expect(r.approvable).toBe(true);
  });
});
