// 文字数・件数などの上限（specs/002-strategy-profile spec FR-021・FR-022、research.md R8）。
// Web の表示・入力の検証、API の検証、DB の CHECK 制約で同じ値を使う。

/** 課題の各項目の文字数の上限。 */
export const STRATEGY_TEXT_MAX = 2000;
/** 宣伝したい内容の文字数の上限。 */
export const PROMOTION_CONTENT_MAX = 2000;
/** 参考投稿の本文の文字数の上限。 */
export const REFERENCE_BODY_MAX = 2000;
/** 参考投稿の「なぜ良いか」の文字数の上限。 */
export const REFERENCE_WHY_GOOD_MAX = 2000;
/** 短いテキスト（管理用タイトル・届けたい属性・CTA・キーワード・狙いのメモ）の文字数の上限。 */
export const SHORT_TEXT_MAX = 100;
/** URL の文字数の上限。 */
export const URL_MAX = 2000;

/** 1つのAccountに登録できる宣伝内容の件数。 */
export const PROMOTION_LIMIT = 50;
/** 1つのAccountに登録できる参考投稿の件数。 */
export const REFERENCE_POST_LIMIT = 200;
/** 1つのAccountに登録できるキーワードの件数。 */
export const KEYWORD_LIMIT = 100;

/** 宣伝内容の優先度の下限。 */
export const PRIORITY_MIN = 0;
/** 宣伝内容の優先度の上限。 */
export const PRIORITY_MAX = 100;
/** 宣伝投稿の割合の既定値（%）。 */
export const PROMOTION_RATIO_DEFAULT = 20;
