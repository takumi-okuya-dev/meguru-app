// 運営メンバーへの分配の計算（specs/collect/003-revenue-sharing research.md R1・R2、spec FR-012・FR-014）。
// APIも画面も同じ関数を使う（画面は入力しながら出し直す。モバイルの画面からも）。円の整数だけで計算し、傾斜は10倍した整数で持つ。

/** 運営メンバーの役割。 */
export const SHARING_ROLES = ["leader", "member"] as const;
/** 運営メンバーの役割。 */
export type SharingRole = (typeof SHARING_ROLES)[number];
/** 役割の言葉。 */
export const SHARING_ROLE_LABELS: Record<SharingRole, string> = { leader: "リーダー", member: "メンバー" };

/** 傾斜（10倍した整数）の範囲と既定（1.0〜5.0倍、既定1.2倍）。 */
export const RATIO_TENTHS = { min: 10, max: 50, default: 12 } as const;

/** 計算に使う運営メンバー（並びの順に渡す）。 */
export type DistributionMember = { id: string; role: SharingRole; ratioTenths: number | null; isOwner: boolean };

/** 1人の分。total＝base＋remainder。 */
export type DistributionShare = { memberId: string; base: number; remainder: number; total: number };

/** 分配の結果。 */
export type DistributionResult = {
  /** もとの額（A）。赤字ならマイナス */
  amount: number;
  /** 赤字（A ≤ 0）。shares は |A| を同じ決まりで分けた負担の目安 */
  deficit: boolean;
  count: number;
  leaderCount: number;
  memberCount: number;
  shares: DistributionShare[];
  /** 端数を足した運営メンバー（端数がなければ null） */
  remainderTo: string | null;
};

/**
 * 傾斜を倍率の言葉にする。
 * @param tenths - 10倍した整数
 * @returns 「1.2倍」
 */
export function ratioLabel(tenths: number): string {
  return `${(tenths / 10).toFixed(1)}倍`;
}

/**
 * リーダーの傾斜の合計の上限（research R2）。メンバーがいるとき、リーダーの分の合計が A を超えないのは Σr ≤ N のとき。
 * @param members - 運営メンバー
 * @returns 10倍した整数の上限（メンバーがいなければ null＝上限なし）
 */
export function maxRatioTenths(members: readonly Pick<DistributionMember, "role">[]): number | null {
  return members.some((m) => m.role === "member") ? members.length * 10 : null;
}

/**
 * リーダーの傾斜の合計が上限の中か。
 * @param members - 運営メンバー
 * @returns 上限の中なら true
 */
export function ratiosWithinLimit(members: readonly Pick<DistributionMember, "role" | "ratioTenths">[]): boolean {
  const max = maxRatioTenths(members);
  if (max === null) return true;
  return members.reduce((sum, m) => sum + (m.role === "leader" ? (m.ratioTenths ?? RATIO_TENTHS.default) : 0), 0) <= max;
}

/**
 * 端数を足す人：最初のリーダー → 主催者の行 → 最初の人。
 * @param members - 運営メンバー
 * @returns 運営メンバーの番号
 */
function remainderHolder(members: readonly DistributionMember[]): string {
  return (members.find((m) => m.role === "leader") ?? members.find((m) => m.isOwner) ?? members[0]!).id;
}

/**
 * 0以上の額を分ける。
 * @param a - 分ける額（0以上）
 * @param members - 運営メンバー（1人以上）
 * @returns 人ごとの切り捨てた分
 */
function baseShares(a: number, members: readonly DistributionMember[]): Map<string, number> {
  const n = members.length;
  const leaders = members.filter((m) => m.role === "leader");
  const rest = members.filter((m) => m.role === "member");
  const base = new Map<string, number>();
  const ratio = (m: DistributionMember) => m.ratioTenths ?? RATIO_TENTHS.default;
  if (n === 1) {
    base.set(members[0]!.id, a);
  } else if (rest.length === 0) {
    // 全員リーダー：傾斜の比で分ける
    const total = leaders.reduce((s, m) => s + ratio(m), 0);
    for (const m of leaders) base.set(m.id, Math.floor((a * ratio(m)) / total));
  } else {
    // リーダーは A÷N×r、メンバーは残りを等しく分ける（リーダーがいなければ全員で等しく）
    let leaderSum = 0;
    for (const m of leaders) {
      const share = Math.floor((a * ratio(m)) / (n * 10));
      base.set(m.id, share);
      leaderSum += share;
    }
    const each = Math.floor((a - leaderSum) / rest.length);
    for (const m of rest) base.set(m.id, each);
  }
  return base;
}

/**
 * 分配額を出す（FR-012）。全員の合計は、いつも A（赤字なら |A|）と同じ。
 * @param amount - 分ける額（A＝売上 − 経費。円の整数）
 * @param members - 運営メンバー（並びの順。傾斜の上限の中であること）
 * @returns 分配の結果（運営メンバーがいなければ shares は空）
 */
export function computeDistribution(amount: number, members: readonly DistributionMember[]): DistributionResult {
  const deficit = amount <= 0;
  const leaderCount = members.filter((m) => m.role === "leader").length;
  const result: DistributionResult = {
    amount,
    deficit,
    count: members.length,
    leaderCount,
    memberCount: members.length - leaderCount,
    shares: [],
    remainderTo: null,
  };
  if (members.length === 0) return result;
  const a = Math.abs(amount);
  const base = baseShares(a, members);
  const remainder = a - [...base.values()].reduce((s, v) => s + v, 0);
  const holder = remainder > 0 ? remainderHolder(members) : null;
  result.remainderTo = holder;
  result.shares = members.map((m) => {
    const b = base.get(m.id) ?? 0;
    const r = m.id === holder ? remainder : 0;
    return { memberId: m.id, base: b, remainder: r, total: b + r };
  });
  return result;
}
