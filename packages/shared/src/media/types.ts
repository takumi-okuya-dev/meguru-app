// 外部媒体展開の型と決まった値（specs/021-external-media data-model.md「共有の定数」、research.md R1）。
// 媒体ごとの決まり（欄・選択肢・ルール・STEP）は、媒体ごとのファイルに置く（contracts/media.md）。
import type { PromotionEvent } from "../promotion-event";

/** 媒体（並びは画面の順）。 */
export const MEDIA = ["kokuchpro", "peatix", "tsunagate", "jmty", "youtrust"] as const;
/** 媒体。 */
export type Media = (typeof MEDIA)[number];

/** 媒体の名前。 */
export const MEDIA_LABELS: Record<Media, string> = {
  kokuchpro: "こくちーずプロ",
  peatix: "Peatix",
  tsunagate: "つなげーと",
  jmty: "ジモティー",
  youtrust: "YOUTRUST",
};

/** 媒体の一言の説明（一覧の画面）。 */
export const MEDIA_DESCRIPTIONS: Record<Media, string> = {
  kokuchpro: "イベント告知サイト",
  peatix: "チケット販売ができるイベントサイト",
  tsunagate: "趣味・交流のイベントアプリ（ルールが厳しい）",
  jmty: "地域の掲示板（連絡先を書けない）",
  youtrust: "仕事専用のSNS",
};

/** 掲載の状況。 */
export const LISTING_STATUSES = ["not_started", "drafting", "posted", "stopped"] as const;
/** 掲載の状況。 */
export type ListingStatus = (typeof LISTING_STATUSES)[number];
/** 掲載の状況の名前。 */
export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  not_started: "未着手",
  drafting: "作成中",
  posted: "掲載済み",
  stopped: "掲載停止",
};

/** 画像の種類。 */
export const IMAGE_STYLES = ["illustration", "photo"] as const;
/** 画像の種類。 */
export type ImageStyle = (typeof IMAGE_STYLES)[number];

/** 欄の種類。 */
export type MediaFieldKind = "text" | "textarea" | "select";

/** 媒体の欄。 */
export type MediaField = {
  key: string;
  /** 媒体の画面での欄の名前 */
  label: string;
  /** 区切り（MediaDefinition.steps の位置） */
  step: number;
  kind: MediaFieldKind;
  /** 選ぶ欄の選択肢（媒体の画面と同じ） */
  options?: readonly string[];
  required?: boolean;
  /** 登録後に変えられない */
  immutable?: boolean;
  /** 文字数の上限 */
  max?: number;
  /** 欄の説明（灰色の小さな文字） */
  help?: string;
  /** 媒体の既定値で入れられる（事務局名・連絡先など） */
  defaultable?: boolean;
  /** 自動の直しを通す（本文など） */
  fixable?: boolean;
};

/** 欄の値（key → 値）。 */
export type ListingValues = Record<string, string>;

/** ルールのチェックの項目。 */
export type ListingCheck = { level: "red" | "yellow" | "info"; field?: string; message: string };

/** 自動で直した内容（外した行）。 */
export type ListingFix = { field: string; excerpt: string; reason: string };

/** 掲載内容を作る材料（宣伝内容・イベントの情報・媒体の既定値）。 */
export type ListingSource = {
  title: string;
  content: string;
  targetLocation: string;
  targetPersona: string;
  targetAgeRange: string;
  cta: string;
  linkedUrl: string;
  event: PromotionEvent | null;
  defaults: ListingValues;
};

/** 組み立てた結果（欄の値・選んだ理由・タイトルのほかの案）。 */
export type BuiltValues = { fields: ListingValues; reasons: Record<string, string>; titleCandidates: string[] };

/** 作業の画面のSTEP。 */
export type WorkStep = {
  title: string;
  /** 媒体の画面で何をするかの1行 */
  instruction?: string;
  /** 値を出す欄 */
  fields?: readonly string[];
  /** 画像のプロンプトのコピーを出す */
  image?: boolean;
  /** ルールの確認のSTEP */
  ruleCheck?: boolean;
  /** 公開のSTEP（媒体ごとの決まりを添える） */
  publish?: boolean;
};

/** 行を外す決まり。 */
export type FixRule = { reason: string; test: (line: string) => boolean };

/** 媒体の画像の決まり。 */
export type MediaImageSpec = {
  /** 大きさと縦横の比（例：1840×900px（横長 約2:1）） */
  size: string;
  /** 一覧での見え方・置き方 */
  layout: string;
  /** 目立つ画像の傾向 */
  trend: string;
  /** 媒体ごとの入れてはいけないもの（共通のものに足す） */
  avoid: readonly string[];
};

/** 媒体の決まり。 */
export type MediaDefinition = {
  media: Media;
  /** 区切り（媒体の画面のステップ） */
  steps: readonly string[];
  fields: readonly MediaField[];
  /** 本文の行を外す決まり（こくちーずプロは空） */
  fixRules: readonly FixRule[];
  /** 欄の値を組み立てる */
  build: (src: ListingSource) => BuiltValues;
  /** 自動の直しのあとに足すもの（ジモティーの「詳細・お申し込み」など） */
  finalize?: (values: ListingValues, src: ListingSource) => ListingValues;
  /** ルールのチェック（共通のもののほかに、この媒体の分） */
  rules: (values: ListingValues, src: ListingSource) => ListingCheck[];
  workSteps: readonly WorkStep[];
  /** 公開のSTEPに添える媒体ごとの決まり */
  publishNotes: readonly string[];
  image: MediaImageSpec;
  /** 「AIと整える」で頼むときの媒体の決まり */
  polishGuide: readonly string[];
};
