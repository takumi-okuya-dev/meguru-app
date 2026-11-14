// 分配の計算（specs/collect/003-revenue-sharing research.md R1・R2、tasks.md T002）。
import { describe, expect, it } from "vitest";
import { computeDistribution, maxRatioTenths, ratioLabel, ratiosWithinLimit, type DistributionMember } from "../../../src";

const leader = (id: string, ratioTenths = 12, isOwner = false): DistributionMember => ({ id, role: "leader", ratioTenths, isOwner });
const member = (id: string): DistributionMember => ({ id, role: "member", ratioTenths: null, isOwner: false });
const totals = (r: ReturnType<typeof computeDistribution>) => Object.fromEntries(r.shares.map((s) => [s.memberId, s.total]));
const sum = (r: ReturnType<typeof computeDistribution>) => r.shares.reduce((s, x) => s + x.total, 0);

describe("computeDistribution", () => {
  it("spec の例：20,000円・4人・リーダー1人・1.2倍 → リーダー6,002円（端数2円）・メンバー各4,666円", () => {
    const r = computeDistribution(20_000, [leader("L", 12, true), member("a"), member("b"), member("c")]);
    expect(totals(r)).toEqual({ L: 6_002, a: 4_666, b: 4_666, c: 4_666 });
    expect(r.shares[0]).toEqual({ memberId: "L", base: 6_000, remainder: 2, total: 6_002 });
    expect(r.remainderTo).toBe("L");
    expect(r.deficit).toBe(false);
    expect(sum(r)).toBe(20_000);
  });

  it("1.5倍にすると、リーダー7,502円・メンバー各4,166円", () => {
    const r = computeDistribution(20_000, [leader("L", 15), member("a"), member("b"), member("c")]);
    expect(totals(r)).toEqual({ L: 7_502, a: 4_166, b: 4_166, c: 4_166 });
  });

  it("リーダーが2人：それぞれ A÷N×r、端数は最初のリーダー", () => {
    const r = computeDistribution(10_001, [member("a"), leader("L1"), leader("L2", 15), member("b")]);
    // L1 floor(10001×12/40)=3000、L2 floor(10001×15/40)=3750、メンバー floor(3251/2)=1625、端数1
    expect(totals(r)).toEqual({ a: 1_625, L1: 3_001, L2: 3_750, b: 1_625 });
    expect(r.remainderTo).toBe("L1");
  });

  it("全員リーダー：傾斜の比で分ける", () => {
    const r = computeDistribution(10_000, [leader("L1", 10), leader("L2", 15)]);
    expect(totals(r)).toEqual({ L1: 4_000, L2: 6_000 });
  });

  it("リーダーがいない：全員で等しく、端数は主催者の行", () => {
    const owner: DistributionMember = { id: "o", role: "member", ratioTenths: null, isOwner: true };
    const r = computeDistribution(10_000, [member("a"), owner, member("b")]);
    expect(totals(r)).toEqual({ a: 3_333, o: 3_334, b: 3_333 });
    expect(r.remainderTo).toBe("o");
  });

  it("1人なら全額", () => {
    expect(totals(computeDistribution(12_345, [leader("L", 15)]))).toEqual({ L: 12_345 });
  });

  it("赤字は |A| を同じ決まりで分けた負担の目安", () => {
    const r = computeDistribution(-20_000, [leader("L"), member("a"), member("b"), member("c")]);
    expect(r.deficit).toBe(true);
    expect(r.amount).toBe(-20_000);
    expect(totals(r)).toEqual({ L: 6_002, a: 4_666, b: 4_666, c: 4_666 });
  });

  it("0円は赤字の扱いで、みな0円", () => {
    const r = computeDistribution(0, [leader("L"), member("a")]);
    expect(r.deficit).toBe(true);
    expect(sum(r)).toBe(0);
    expect(r.remainderTo).toBeNull();
  });

  it("運営メンバーがいなければ空", () => {
    expect(computeDistribution(1_000, []).shares).toEqual([]);
  });

  it("いろいろな入力で、合計はいつも A と同じ・だれもマイナスにならない", () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 500; i += 1) {
      const n = 1 + rand(20);
      const ms: DistributionMember[] = Array.from({ length: n }, (_, k) => (rand(3) === 0 ? leader(`m${k}`, 10 + rand(41)) : member(`m${k}`)));
      if (!ratiosWithinLimit(ms)) continue;
      const a = rand(2_000_000) - 200_000;
      const r = computeDistribution(a, ms);
      expect(sum(r)).toBe(Math.abs(a));
      for (const s of r.shares) expect(s.total).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("傾斜の上限", () => {
  it("メンバーがいれば人数×10、いなければ上限なし", () => {
    expect(maxRatioTenths([{ role: "leader" }, { role: "member" }, { role: "member" }])).toBe(30);
    expect(maxRatioTenths([{ role: "leader" }, { role: "leader" }])).toBeNull();
  });

  it("リーダーの合計が上限を超えたら false", () => {
    expect(ratiosWithinLimit([leader("L", 20), member("a")])).toBe(true);
    expect(ratiosWithinLimit([leader("L", 21), member("a")])).toBe(false);
    expect(ratiosWithinLimit([leader("L1", 50), leader("L2", 50)])).toBe(true);
  });

  it("倍率の言葉", () => {
    expect(ratioLabel(12)).toBe("1.2倍");
    expect(ratioLabel(10)).toBe("1.0倍");
  });
});
