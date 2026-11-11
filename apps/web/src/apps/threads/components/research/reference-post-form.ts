// 参考投稿の入力欄の値と、送る形への変換・検証（specs/014-strategy-guidance FR-095〜FR-097）。
// 追加（ためて登録）と編集の両方で使う。
import {
  REFERENCE_AUTHOR_MAX,
  REFERENCE_BODY_MAX,
  REFERENCE_MEMO_MAX,
  REFERENCE_METRIC_KEYS,
  REFERENCE_METRIC_MAX,
  REFERENCE_WHY_GOOD_MAX,
  SHORT_TEXT_MAX,
  URL_MAX,
  countChars,
  freshnessOf,
  isBlank,
  isHttpUrl,
  isValidYmd,
  jstToday,
  type Freshness,
  type PostedDateMode,
  type ReferenceMetricKey,
  type ReferencePlatform,
  type ReferencePost,
  type ReferencePostInputBody,
} from "@meguru/shared";
import type { FormErrors } from "@/components/items/use-item-form";

/** 参考投稿の入力欄の値。数字は入力のままの文字。 */
export type RefForm = {
  body: string;
  keyword: string;
  postUrl: string;
  whyGood: string;
  platform: ReferencePlatform;
  postedDateMode: PostedDateMode;
  /** "" は未入力 */
  postedDate: string;
  author: string;
  memo: string;
} & Record<ReferenceMetricKey, string>;

/** 空の入力欄。 */
export const EMPTY_REF_FORM: RefForm = {
  body: "",
  keyword: "",
  postUrl: "",
  whyGood: "",
  platform: "threads",
  postedDateMode: "unknown",
  postedDate: "",
  author: "",
  memo: "",
  likes: "",
  replies: "",
  views: "",
  saves: "",
  reposts: "",
  followers: "",
};

/**
 * 保存済みの参考投稿を入力欄の値にする。
 * @param p - 参考投稿
 * @returns 入力欄の値
 */
export function toRefForm(p: ReferencePost): RefForm {
  const metrics = Object.fromEntries(
    REFERENCE_METRIC_KEYS.map((k) => [k, p.metrics[k] === null ? "" : String(p.metrics[k])]),
  ) as Record<ReferenceMetricKey, string>;
  return {
    body: p.body,
    keyword: p.keyword,
    postUrl: p.postUrl,
    whyGood: p.whyGood,
    platform: p.platform,
    postedDateMode: p.postedDateMode,
    postedDate: p.postedDate ?? "",
    author: p.author,
    memo: p.memo,
    ...metrics,
  };
}

/**
 * 入力欄の値を、APIに送る形にする。
 * @param f - 入力欄の値
 * @returns 送る形
 */
export function toRefInput(f: RefForm): ReferencePostInputBody {
  const metrics = Object.fromEntries(
    REFERENCE_METRIC_KEYS.map((k) => [k, f[k].trim() === "" ? null : Number(f[k])]),
  ) as Record<ReferenceMetricKey, number | null>;
  return {
    body: f.body,
    keyword: f.keyword,
    postUrl: f.postUrl,
    whyGood: f.whyGood,
    platform: f.platform,
    postedDateMode: f.postedDateMode,
    postedDate: f.postedDateMode === "exact" ? f.postedDate : null,
    metrics,
    author: f.author,
    memo: f.memo,
  };
}

const isMetric = (s: string) => {
  if (s.trim() === "") return true;
  if (!/^\d+$/.test(s.trim())) return false;
  return Number(s) <= REFERENCE_METRIC_MAX;
};

/**
 * 入力欄の検証（APIの検証と同じ条件）。
 * @param f - 入力欄の値
 * @param today - 今日（日本時間の YYYY-MM-DD）
 * @returns 項目ごとの誤り
 */
export function validateRef(f: RefForm, today = jstToday(new Date())): FormErrors<RefForm> {
  const errors: FormErrors<RefForm> = {
    body: isBlank(f.body) ? "入力してください" : undefined,
    postUrl: f.postUrl !== "" && !isHttpUrl(f.postUrl) ? "https:// から始まるURLを入力してください" : undefined,
  };
  if (f.postedDateMode === "exact") {
    if (f.postedDate === "" || !isValidYmd(f.postedDate)) errors.postedDate = "投稿日を入れてください";
    else if (f.postedDate > today) errors.postedDate = "今日より後の日付は選べません";
  }
  for (const k of REFERENCE_METRIC_KEYS) {
    if (!isMetric(f[k])) errors[k] = "0以上の整数で入力してください";
  }
  return errors;
}

/**
 * 文字数の上限を超えているか。
 * @param f - 入力欄の値
 * @returns 超えていれば true
 */
export function overLimitRef(f: RefForm): boolean {
  return (
    countChars(f.body) > REFERENCE_BODY_MAX ||
    countChars(f.keyword) > SHORT_TEXT_MAX ||
    countChars(f.postUrl) > URL_MAX ||
    countChars(f.whyGood) > REFERENCE_WHY_GOOD_MAX ||
    countChars(f.author) > REFERENCE_AUTHOR_MAX ||
    countChars(f.memo) > REFERENCE_MEMO_MAX
  );
}

/**
 * 入力中の値の鮮度（今日登録したとみなす）。
 * @param f - 入力欄の値
 * @param today - 今日（日本時間の YYYY-MM-DD）
 * @returns 鮮度
 */
export function freshnessOfForm(f: RefForm, today = jstToday(new Date())): Freshness {
  return freshnessOf(
    { postedDateMode: f.postedDateMode, postedDate: f.postedDateMode === "exact" && f.postedDate ? f.postedDate : null, createdAt: new Date() },
    today,
  );
}
