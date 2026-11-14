// 声かけリスト（specs/people/002-sales-list）の決まりの値と、SNS のリンクの確かめ。APIと画面で同じものを使う。

/** タグの名前の上限。 */
export const TAG_NAME_MAX = 30;
/** 1人に付けられるタグの数。 */
export const TAGS_PER_PERSON_MAX = 20;
/** 作り手が持てるタグの数。 */
export const TAGS_MAX = 100;
/** 次にやることの文の上限。 */
export const NEXT_ACTION_MAX = 200;
/** 連絡の記録の上限。 */
export const CONTACT_NOTE_MAX = 1000;
/** 自由な項目の名前の上限。 */
export const FIELD_LABEL_MAX = 30;
/** 作り手が持てる自由な項目の数。 */
export const FIELDS_MAX = 30;
/** 自由な項目の値の上限。 */
export const FIELD_VALUE_MAX = 500;
/** SNS のリンクの上限。 */
export const LINK_URL_MAX = 500;
/** 書き出せる人数の上限（超えたら最初の分だけ書き出す）。 */
export const EXPORT_LIMIT = 10_000;
/** ホームのそれぞれのまとまりに出す人数の上限。 */
export const HOME_LIMIT = 200;
/** ホームの「近い誕生日」に出す日数（今日を含めて）。 */
export const BIRTHDAY_WINDOW_DAYS = 7;

/** 連絡の記録の「何で」（done は次にやることを終えた記録）。 */
export const CONTACT_CHANNELS = ["line", "venue", "other", "done"] as const;
/** 連絡の記録の「何で」。 */
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
/** 人の一覧の並べ方。 */
export const PERSON_SORTS = ["last_met", "first_met", "updated", "kana", "likelihood"] as const;
/** 人の一覧の並べ方。 */
export type PersonSort = (typeof PERSON_SORTS)[number];
/** 人の一覧のまとめた表示。 */
export const PERSON_GROUPS = ["none", "month", "tag", "kana"] as const;
/** 人の一覧のまとめた表示。 */
export type PersonGroup = (typeof PERSON_GROUPS)[number];
/** SNS のリンクの種類。 */
export const LINK_KINDS = ["instagram", "x", "facebook"] as const;
/** SNS のリンクの種類。 */
export type LinkKind = (typeof LINK_KINDS)[number];

/** 種類ごとに許すホスト（www. つきも許す）。 */
const LINK_HOSTS: Record<LinkKind, readonly string[]> = {
  instagram: ["instagram.com"],
  x: ["x.com", "twitter.com"],
  facebook: ["facebook.com"],
};

/**
 * SNS のリンクとして許す URL か（https で、その種類のホストのものだけ。開くボタンが別のサイトへ飛ばないように）。
 * @param kind - 種類
 * @param url - URL
 * @returns 許すなら true
 */
export function isAllowedLinkUrl(kind: LinkKind, url: string): boolean {
  // URL の部品を読む（共通のパッケージは DOM の型を読まないので、URL のクラスを使わずに形で確かめる）。ユーザー名・ポートつきは断る
  // スキームは小文字の https だけ（DB の check と同じ）。ホストは大文字も小文字にそろえて比べる
  const m = /^https:\/\/([A-Za-z0-9.-]+)(\/[^\s]*)?$/.exec(url);
  if (!m) return false;
  const host = m[1]!.toLowerCase().replace(/^www\./, "");
  return LINK_HOSTS[kind].includes(host);
}

/** 月ごとの日数（2月は29日まで。誕生日なので、うるう年の2月29日も許す）。 */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * ある月日（MM-DD）か（02-30・04-31 などを断る）。
 * @param md - 月日
 * @returns ある月日なら true
 */
export function isRealMonthDay(md: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(md);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1]!;
}
