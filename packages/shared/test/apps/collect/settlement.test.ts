// 精算の手順（specs/collect/003-revenue-sharing User Story 4、research.md R10、tasks.md T032）。
import { describe, expect, it } from "vitest";
import {
  createSettlementTransferRequestSchema,
  settlementSteps,
  type SettlementParty,
  type SettlementStep,
} from "../../../src";

const party = (
  key: string,
  holding: number,
  target: number,
  extra: Partial<SettlementParty> = {},
): SettlementParty => ({
  key,
  name: key,
  kind: "member",
  isOwner: false,
  holding,
  target,
  ...extra,
});
const brief = (steps: SettlementStep[]) => steps.map((s) => `${s.fromKey}>${s.toKey}:${s.amount}`);

/**
 * 手順のとおりに渡したあと、全員が受け取る合計ちょうどになるか。
 * @param parties - 人
 * @param steps - 手順
 * @returns 人ごとの残りの差
 */
function afterSteps(parties: SettlementParty[], steps: SettlementStep[]): number[] {
  const diff = new Map(parties.map((p) => [p.key, p.holding - p.target]));
  for (const s of steps) {
    diff.set(s.fromKey, diff.get(s.fromKey)! - s.amount);
    diff.set(s.toKey, diff.get(s.toKey)! + s.amount);
  }
  return [...diff.values()];
}

describe("settlementSteps", () => {
  it("spec の例：主催者 PayPay 15,000（経費 4,000 を払った）・井上 現金 9,000 → 全員の受け取りが分配額と合う", () => {
    const parties = [
      party("m:owner", 11_000, 6_002, { isOwner: true }),
      party("m:inoue", 9_000, 4_666),
      party("m:kimura", 0, 4_666),
      party("m:sato", 0, 4_666),
    ];
    const plan = settlementSteps(parties);
    expect(plan.mismatch).toBe(0);
    expect(brief(plan.steps)).toEqual([
      "m:owner>m:kimura:4666",
      "m:inoue>m:sato:4334",
      "m:owner>m:sato:332",
    ]);
    expect(afterSteps(parties, plan.steps)).toEqual([0, 0, 0, 0]);
  });

  it("運営メンバーでない手伝う人の現金は、主催者に全額渡す", () => {
    const parties = [
      party("m:owner", 0, 5_000, { isOwner: true }),
      party("m:a", 0, 5_000),
      party("h:helper", 10_000, 0, { kind: "helper" }),
    ];
    const plan = settlementSteps(parties);
    expect(brief(plan.steps)).toEqual(["h:helper>m:owner:10000", "m:owner>m:a:5000"]);
    expect(afterSteps(parties, plan.steps)).toEqual([0, 0, 0]);
  });

  it("同じ額の組を先に当てる", () => {
    const parties = [
      party("m:o", 7_000, 0, { isOwner: true }),
      party("m:a", 3_000, 0),
      party("m:b", 0, 3_000),
      party("m:c", 0, 7_000),
    ];
    expect(brief(settlementSteps(parties).steps)).toEqual(["m:o>m:c:7000", "m:a>m:b:3000"]);
  });

  it("運営メンバーでない立て替えた人には、戻しを渡す（主催者を通さない）", () => {
    const parties = [
      party("m:o", 10_000, 8_000, { isOwner: true }),
      party("p:yamada", 0, 2_000, { kind: "payer" }),
    ];
    expect(brief(settlementSteps(parties).steps)).toEqual(["m:o>p:yamada:2000"]);
  });

  it("赤字（受け取る合計が負）は、メンバーが主催者に負担を渡す", () => {
    const parties = [party("m:o", -3_000, -1_500, { isOwner: true }), party("m:a", 0, -1_500)];
    expect(brief(settlementSteps(parties).steps)).toEqual(["m:a>m:o:1500"]);
  });

  it("受け取りすぎた今はいない人は、主催者に返す", () => {
    const parties = [
      party("m:o", 0, 4_000, { isOwner: true }),
      party("m:gone", 4_000, 0, { kind: "former" }),
    ];
    expect(brief(settlementSteps(parties).steps)).toEqual(["m:gone>m:o:4000"]);
  });

  it("もう合っていれば手順はない", () => {
    expect(
      settlementSteps([party("m:o", 6_000, 6_000, { isOwner: true }), party("m:a", 4_000, 4_000)]),
    ).toEqual({ steps: [], mismatch: 0 });
  });

  it("持っている額と受け取る合計が合わなければ、合わない額を返して手順は出さない", () => {
    expect(
      settlementSteps([party("m:o", 6_000, 5_000, { isOwner: true }), party("m:a", 0, 500)]),
    ).toEqual({ steps: [], mismatch: 500 });
  });

  it("でたらめな入力でも、手順のあとは全員ちょうど・回数は差のある人の数 − 1 まで・渡す額はいつも正", () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    for (let trial = 0; trial < 500; trial += 1) {
      const n = 2 + rand(12);
      const kinds = ["member", "member", "helper", "payer", "former"] as const;
      const parties = Array.from({ length: n }, (_, i) =>
        party(`k${i}`, rand(30_000), rand(30_000), {
          isOwner: i === 0,
          kind: i === 0 ? "member" : kinds[rand(kinds.length)]!,
        }),
      );
      // 合計をそろえる（主催者で合わせる）
      const gap = parties.reduce((s, p) => s + p.holding - p.target, 0);
      parties[0]!.target += gap;
      const plan = settlementSteps(parties);
      expect(plan.mismatch).toBe(0);
      expect(afterSteps(parties, plan.steps).every((d) => d === 0)).toBe(true);
      expect(plan.steps.every((s) => s.amount > 0 && s.fromKey !== s.toKey)).toBe(true);
      const nonZero = parties.filter((p) => p.holding !== p.target).length;
      expect(plan.steps.length).toBeLessThanOrEqual(
        Math.max(0, nonZero - 1) +
          parties.filter((p) => p.kind === "helper" || p.kind === "former").length,
      );
    }
  });
});

describe("createSettlementTransferRequestSchema", () => {
  it("同じ人どうし・知らない頭の鍵・0円は受けない", () => {
    expect(
      createSettlementTransferRequestSchema.safeParse({ fromKey: "m:a", toKey: "m:a", amount: 1 })
        .success,
    ).toBe(false);
    expect(
      createSettlementTransferRequestSchema.safeParse({ fromKey: "x:a", toKey: "m:b", amount: 1 })
        .success,
    ).toBe(false);
    expect(
      createSettlementTransferRequestSchema.safeParse({ fromKey: "m:a", toKey: "m:b", amount: 0 })
        .success,
    ).toBe(false);
    expect(
      createSettlementTransferRequestSchema.safeParse({
        fromKey: "h:a",
        toKey: "p:やまだ",
        amount: 100,
      }).success,
    ).toBe(true);
  });
});
