// 投稿ごとの値と区切り（specs/022-algorithm-analysis research.md R3・R4）。
import type { PostLengthSettings } from "../schemas";
import { countChars } from "../text";
import { isJapaneseHoliday } from "./holidays";
import { TIME_BUCKETS, type AnalysisPost, type LengthBucket, type PostValues, type TextFeature, type TimeBucket } from "./types";

const JST_OFFSET_MS = 9 * 3_600_000;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const CALLOUT_RE = /あなた|みんな|皆さん|みなさん/;

/** 文字数の区切り。`max` は含む上限（長いは null）。 */
export type LengthBucketDef = { key: LengthBucket; label: string; max: number | null };

/**
 * 文字数の区切り。Accountの短文・中文・長文の長さの間で分ける（research.md R4）。
 * @param ls - 014の文字数の設定
 * @returns 短い・中くらい・長い
 */
export function lengthBuckets(ls: PostLengthSettings): LengthBucketDef[] {
  const shortMax = Math.floor((ls.shortLength + ls.mediumLength) / 2);
  const mediumMax = Math.floor((ls.mediumLength + ls.longLength) / 2);
  return [
    { key: "short", label: `短い（〜${shortMax}字）`, max: shortMax },
    { key: "medium", label: `中くらい（${shortMax + 1}〜${mediumMax}字）`, max: mediumMax },
    { key: "long", label: `長い（${mediumMax + 1}字〜）`, max: null },
  ];
}

/**
 * 時間帯（日本時間の時）。
 * @param hour - 時（0〜23）
 * @returns 時間帯
 */
function timeBucketOf(hour: number): TimeBucket {
  return TIME_BUCKETS.find((b) => hour >= b.from && hour <= b.to)!.key;
}

/**
 * 本文の特徴（research.md R4 の表）。
 * @param body - 本文
 * @returns 特徴ごとのあり・なし
 */
function featuresOf(body: string): Record<TextFeature, boolean> {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const last = lines.at(-1) ?? "";
  return {
    question: /[？?]$/.test(last),
    number: /[0-9０-９]/.test(body),
    shortFirstLine: lines.length > 0 && countChars(lines[0]!) <= 20,
    manyLines: lines.length >= 5,
    emoji: EMOJI_RE.test(body),
    callout: CALLOUT_RE.test(body),
  };
}

const ratioOf = (a: number, b: number | null) => (b === null || b <= 0 ? null : a / b);

/**
 * 投稿ごとの値を求める（research.md R3）。
 * @param p - 確定した投稿
 * @param ls - 014の文字数の設定
 * @returns 値
 */
export function postValues(p: AnalysisPost, ls: PostLengthSettings): PostValues {
  const local = new Date(new Date(p.publishedAt).getTime() + JST_OFFSET_MS);
  const ymd = local.toISOString().slice(0, 10);
  const dow = local.getUTCDay();
  const length = countChars(p.body);
  const lb = lengthBuckets(ls).find((b) => b.max === null || length <= b.max)!.key;
  return {
    timeBucket: timeBucketOf(local.getUTCHours()),
    dayKind: dow === 0 || dow === 6 || isJapaneseHoliday(ymd) ? "holiday" : "weekday",
    lengthBucket: lb,
    length,
    features: featuresOf(p.body),
    engagementRate: ratioOf(p.likes + p.replies + p.reposts + p.quotes, p.views),
    replyRate: ratioOf(p.replies, p.views),
    spread: ratioOf(p.views, p.followersAtPost),
    firstSpeed: p.h24Views,
    laterGrowth: ratioOf(p.views, p.h24Views),
  };
}
