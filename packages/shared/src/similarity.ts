// 下書きどうしの類似度（specs/004-review-approval FR-026・FR-028、research.md R8）。
// 意味の近さではなく文字の並びの近さで測る（アプリの中でAIを使わない。Constitution原則III）。
// Workers のCPU時間の制約を避けるため、Webで計算する。
import {
  SIMILARITY_EDIT_DISTANCE_MAX_LENGTH,
  SIMILARITY_MIN_LENGTH,
  SIMILARITY_TOP_MATCHES,
} from "./limits";
import { normalizeForMatch } from "./normalize";

/** 比べる本文。 */
export type SimilarityInput = { id: string; body: string };

/** 1件の下書きの類似度の結果。score はもっとも高い値（0〜100）、matches は高い順の相手。 */
export type SimilarityResult = { score: number; matches: { id: string; score: number }[] };

/** Dice係数がこれ未満の組は、編集距離を求めない（候補の絞り込み）。 */
const EDIT_DISTANCE_MIN_DICE = 0.3;
/** 各下書きで編集距離を求める候補の数。 */
const EDIT_DISTANCE_CANDIDATES = 5;

// 空白・改行、句読点・記号、絵文字（結合子・異体字セレクタを含む）を除く
const IGNORED = /[\s\p{P}\p{S}\p{Extended_Pictographic}]|\u200d|\ufe0f|\u20e3/gu;

/**
 * 比べるために正規化する：NFKC → 小文字 → 空白・句読点・記号・絵文字を除く。
 * @param body - 本文
 * @returns コードポイントの配列
 */
function normalizeForSimilarity(body: string): string[] {
  return [...normalizeForMatch(body).normalized.replace(IGNORED, "")];
}

/**
 * 2文字組の多重集合（組 → 個数）。
 * @param chars - 正規化した文字
 * @returns 2文字組の個数
 */
function bigrams(chars: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i + 1 < chars.length; i++) {
    const g = chars[i]! + chars[i + 1]!;
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/**
 * レーベンシュタイン距離（2行のDP。メモリはO(n)）。
 * @param a - 文字の配列
 * @param b - 文字の配列
 * @returns 距離
 */
function levenshtein(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

type Prepared = { id: string; chars: string[]; grams: Map<string, number>; total: number };

function prepare(items: SimilarityInput[]): Prepared[] {
  const out: Prepared[] = [];
  for (const { id, body } of items) {
    const chars = normalizeForSimilarity(body);
    // 短すぎる本文は、比べる側にも比べられる側にも入れない（偶然似やすいため）
    if (chars.length < SIMILARITY_MIN_LENGTH) continue;
    out.push({ id, chars, grams: bigrams(chars), total: chars.length - 1 });
  }
  return out;
}

/**
 * 各対象の下書きについて、相手の下書きとの類似度を求める。
 * 類似度は「2文字組のDice係数」と「編集距離の比」の大きいほう（長い本文の組はDice係数だけ）。
 * @param targets - 類似度を出す下書き（要確認）
 * @param others - 比べる相手（同じAccountの全下書き。targets を含んでよい）
 * @returns 対象のID → 結果。正規化した後の長さが10文字未満の対象は含まない
 */
export function computeSimilarities(
  targets: SimilarityInput[],
  others: SimilarityInput[],
): Map<string, SimilarityResult> {
  const ts = prepare(targets);
  const os = prepare(others);
  // 2文字組 → それを含む相手（相手の位置と個数）の逆引き
  const index = new Map<string, { o: number; n: number }[]>();
  os.forEach((p, o) => {
    for (const [g, n] of p.grams) {
      const list = index.get(g);
      if (list) list.push({ o, n });
      else index.set(g, [{ o, n }]);
    }
  });

  const result = new Map<string, SimilarityResult>();
  for (const t of ts) {
    // 共通の2文字組の数（多重集合の共通部分）
    const common = new Map<number, number>();
    for (const [g, n] of t.grams) {
      for (const { o, n: m } of index.get(g) ?? [])
        common.set(o, (common.get(o) ?? 0) + Math.min(n, m));
    }
    const scored: { o: number; dice: number }[] = [];
    for (const [o, c] of common) {
      if (os[o]!.id === t.id) continue;
      scored.push({ o, dice: (2 * c) / (t.total + os[o]!.total) });
    }
    scored.sort((a, b) => b.dice - a.dice);
    const final = scored.map(({ o, dice }, rank) => {
      const other = os[o]!;
      let s = dice;
      const short =
        t.chars.length <= SIMILARITY_EDIT_DISTANCE_MAX_LENGTH &&
        other.chars.length <= SIMILARITY_EDIT_DISTANCE_MAX_LENGTH;
      if (short && rank < EDIT_DISTANCE_CANDIDATES && dice >= EDIT_DISTANCE_MIN_DICE) {
        const ratio =
          1 - levenshtein(t.chars, other.chars) / Math.max(t.chars.length, other.chars.length);
        s = Math.max(s, ratio);
      }
      return { id: other.id, score: Math.round(s * 100) };
    });
    final.sort((a, b) => b.score - a.score);
    result.set(t.id, {
      score: final[0]?.score ?? 0,
      matches: final.slice(0, SIMILARITY_TOP_MATCHES),
    });
  }
  return result;
}
