// 精算の手順（specs/collect/003-revenue-sharing User Story 4、research.md R10、tasks.md T032）。
// だれがいくら持っていて、いくら受け取るかから、「だれがだれにいくら渡すか」を出す。API と画面で同じものを使う。
import { z } from "zod";

/** 精算の上限（data-model.md 1-4）。 */
export const SETTLEMENT_LIMITS = {
  /** 「渡した」の数（1イベント） */
  transfersPerEvent: 200,
  /** 人の鍵の長さ */
  keyLength: 80,
  /** 1回に渡す額 */
  amountMax: 99_999_999,
} as const;

/** 人の種類：運営メンバー・手伝う人（運営メンバーでない）・立て替えた人（運営メンバーでない）・今はいない人（消した運営メンバーなど）。 */
export const SETTLEMENT_PARTY_KINDS = ["member", "helper", "payer", "former"] as const;

/** 人の種類。 */
export type SettlementPartyKind = (typeof SETTLEMENT_PARTY_KINDS)[number];

/** 人の鍵の頭（research R10）。 */
export const SETTLEMENT_KEY_PREFIX = { member: "m:", helper: "h:", payer: "p:" } as const;

/** 精算の人。holding＝今持っている額（渡したものを足し引きしたあと）、target＝受け取る合計（負なら負担）。 */
export type SettlementParty = {
  key: string;
  name: string;
  kind: SettlementPartyKind;
  isOwner: boolean;
  holding: number;
  target: number;
};

/** 精算の手順の1行。 */
export type SettlementStep = {
  fromKey: string;
  fromName: string;
  toKey: string;
  toName: string;
  amount: number;
};

/** 手順の結果。mismatch が0でなければ、持っている額と受け取る合計が合わない（手順は空）。 */
export type SettlementPlan = { steps: SettlementStep[]; mismatch: number };

/**
 * 精算の手順を出す（FR-030）。
 * ①運営メンバーでなく立て替えた人でもない人（手伝う人・今はいない人）が持つ分は、主催者に渡す。
 * ②同じ額を渡す人と受け取る人の組を先に当てる。③いちばん多く渡す人から、いちばん多く受け取る人へ渡す。
 * 回数は（差のある人の数 − 1）まで。並びが同じなら、いつも同じ手順になる。
 * @param parties - 人（並びの順）
 * @returns 手順
 */
export function settlementSteps(parties: readonly SettlementParty[]): SettlementPlan {
  const people = parties.map((p, index) => ({ ...p, index, diff: p.holding - p.target }));
  const mismatch = people.reduce((s, p) => s + p.diff, 0);
  if (mismatch !== 0) return { steps: [], mismatch };
  const steps: SettlementStep[] = [];
  const give = (from: (typeof people)[number], to: (typeof people)[number], amount: number) => {
    steps.push({ fromKey: from.key, fromName: from.name, toKey: to.key, toName: to.name, amount });
    from.diff -= amount;
    to.diff += amount;
  };

  // ① 運営メンバーでない人の持つ分は主催者へ
  const owner = people.find((p) => p.isOwner);
  if (owner) {
    for (const p of people) {
      if ((p.kind === "helper" || p.kind === "former") && p.diff > 0 && p !== owner)
        give(p, owner, p.diff);
    }
  }

  // ② 同じ額の組
  for (const from of people) {
    if (from.diff <= 0) continue;
    const to = people.find((p) => p.diff === -from.diff);
    if (to) give(from, to, from.diff);
  }

  // ③ 差の大きい順（同じなら並びの順）
  const byLargest = (a: (typeof people)[number], b: (typeof people)[number]) =>
    b.diff - a.diff || a.index - b.index;
  const byMostOwed = (a: (typeof people)[number], b: (typeof people)[number]) =>
    a.diff - b.diff || a.index - b.index;
  for (;;) {
    const from = people.filter((p) => p.diff > 0).sort(byLargest)[0];
    const to = people.filter((p) => p.diff < 0).sort(byMostOwed)[0];
    if (!from || !to) break;
    give(from, to, Math.min(from.diff, -to.diff));
  }
  return { steps, mismatch: 0 };
}

const partyKey = z
  .string()
  .min(3)
  .max(SETTLEMENT_LIMITS.keyLength)
  .refine((k) => Object.values(SETTLEMENT_KEY_PREFIX).some((prefix) => k.startsWith(prefix)), {
    message: "invalid key",
  });

/** 手伝う人と運営メンバーの対応を選ぶ（PUT …/settlement/helpers/:helperId。FR-032）。null は「運営メンバーでない」。 */
export const putSettlementHolderRequestSchema = z.object({ memberId: z.uuid().nullable() });

/** 手伝う人と運営メンバーの対応を選ぶ入力。 */
export type PutSettlementHolderRequest = z.infer<typeof putSettlementHolderRequestSchema>;

/** 「渡した」を付ける（POST …/settlement/transfers。FR-031）。 */
export const createSettlementTransferRequestSchema = z
  .object({
    fromKey: partyKey,
    toKey: partyKey,
    amount: z.number().int().min(1).max(SETTLEMENT_LIMITS.amountMax),
  })
  .refine((v) => v.fromKey !== v.toKey, { message: "same party", path: ["toKey"] });

/** 「渡した」を付ける入力。 */
export type CreateSettlementTransferRequest = z.infer<typeof createSettlementTransferRequestSchema>;

/** 精算の人の形。 */
export const settlementPartySchema = z.object({
  key: z.string(),
  name: z.string(),
  kind: z.enum(SETTLEMENT_PARTY_KINDS),
  isOwner: z.boolean(),
  holding: z.number().int(),
  target: z.number().int(),
});

/** 現金を受け取った手伝う人と、運営メンバーの対応。chosen＝主催者が選んだ（false は名前で自動）。 */
export const settlementHelperSchema = z.object({
  helperId: z.string(),
  name: z.string(),
  cash: z.number().int(),
  memberId: z.string().nullable(),
  chosen: z.boolean(),
});

/** 現金を受け取った手伝う人。 */
export type SettlementHelper = z.infer<typeof settlementHelperSchema>;

const stepSchema = z.object({
  fromKey: z.string(),
  fromName: z.string(),
  toKey: z.string(),
  toName: z.string(),
  amount: z.number().int(),
});

/** 渡したもの。 */
export const settlementTransferSchema = stepSchema.extend({ id: z.string(), doneAt: z.string() });

/** 渡したもの。 */
export type SettlementTransfer = z.infer<typeof settlementTransferSchema>;

/** 精算の手順の画面（GET …/settlement）。 */
export const settlementSnapshotSchema = z.object({
  parties: z.array(settlementPartySchema),
  helpers: z.array(settlementHelperSchema),
  steps: z.array(stepSchema),
  done: z.array(settlementTransferSchema),
  mismatch: z.number().int(),
});

/** 精算の手順の画面。 */
export type SettlementSnapshot = z.infer<typeof settlementSnapshotSchema>;
