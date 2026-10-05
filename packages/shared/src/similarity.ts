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
function normalizeForSimilarity(body: string): number[] {
  return [...normalizeForMatch(body).normalized.replace(IGNORED, "")].map((c) => c.codePointAt(0)!);
}

/** コードポイントの上限＋1。2文字組を1つの数（前 × CODE_SPACE ＋ 後）にする。 */
const CODE_SPACE = 0x110000;

/**
 * 2文字組の多重集合（組 → 個数）。組は数にして持つ（文字列の連結より速い）。
 * @param codes - 正規化した文字のコードポイント
 * @returns 2文字組の個数
 */
function bigrams(codes: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i + 1 < codes.length; i++) {
    const g = codes[i]! * CODE_SPACE + codes[i + 1]!;
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/**
 * レーベンシュタイン距離（2行のDP。メモリはO(n)）。
 * @param a - コードポイントの配列
 * @param b - コードポイントの配列
 * @returns 距離
 */
function levenshtein(a: number[], b: number[]): number {
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1]! + (ai === b[j - 1] ? 0 : 1);
      const del = prev[j]! + 1;
      const ins = cur[j - 1]! + 1;
      cur[j] = sub < del ? (sub < ins ? sub : ins) : del < ins ? del : ins;
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

type Prepared = { id: string; codes: number[]; grams: Map<number, number>; total: number };

function prepare(items: SimilarityInput[], cache: Map<string, Prepared | null>): Prepared[] {
  const out: Prepared[] = [];
  for (const { id, body } of items) {
    // targets と others に同じ下書きが入るので、同じIDと本文の正規化は1回にする
    const key = `${id}\u0000${body}`;
    let p = cache.get(key);
    if (p === undefined) {
      const codes = normalizeForSimilarity(body);
      // 短すぎる本文は、比べる側にも比べられる側にも入れない（偶然似やすいため）
      p =
        codes.length < SIMILARITY_MIN_LENGTH
          ? null
          : { id, codes, grams: bigrams(codes), total: codes.length - 1 };
      cache.set(key, p);
    }
    if (p) out.push(p);
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
  const cache = new Map<string, Prepared | null>();
  const os = prepare(others, cache);
  const ts = prepare(targets, cache);
  // 2文字組 → それを含む相手の逆引き。[相手の位置, 個数, 相手の位置, 個数, …] の平らな配列にする
  const index = new Map<number, number[]>();
  os.forEach((p, o) => {
    for (const [g, n] of p.grams) {
      const list = index.get(g);
      if (list) list.push(o, n);
      else index.set(g, [o, n]);
    }
  });

  const result = new Map<string, SimilarityResult>();
  // 共通の2文字組の数（多重集合の共通部分）。対象ごとに、触れた位置だけを0に戻して使い回す
  const common = new Int32Array(os.length);
  const touched: number[] = [];
  for (const t of ts) {
    for (const [g, n] of t.grams) {
      const list = index.get(g);
      if (!list) continue;
      for (let k = 0; k < list.length; k += 2) {
        const o = list[k]!;
        const m = list[k + 1]!;
        if (common[o] === 0) touched.push(o);
        common[o] = common[o]! + (n < m ? n : m);
      }
    }
    const scored: { o: number; dice: number }[] = [];
    for (const o of touched) {
      if (os[o]!.id !== t.id) scored.push({ o, dice: (2 * common[o]!) / (t.total + os[o]!.total) });
      common[o] = 0;
    }
    touched.length = 0;
    scored.sort((a, b) => b.dice - a.dice);
    const final = scored.map(({ o, dice }, rank) => {
      const other = os[o]!;
      let s = dice;
      const short =
        t.codes.length <= SIMILARITY_EDIT_DISTANCE_MAX_LENGTH &&
        other.codes.length <= SIMILARITY_EDIT_DISTANCE_MAX_LENGTH;
      if (short && rank < EDIT_DISTANCE_CANDIDATES && dice >= EDIT_DISTANCE_MIN_DICE) {
        const ratio =
          1 - levenshtein(t.codes, other.codes) / Math.max(t.codes.length, other.codes.length);
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
