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

// ---- 投稿ストック（specs/003-prompt-bulk-register FR-004・FR-014、research.md R6・R12）----

/** 1回の貼り付けで登録できる下書きの件数。 */
export const PASTE_MAX_DRAFTS = 50;
/** 1回の貼り付けの全体の文字数の上限。 */
export const PASTE_MAX_CHARS = 50000;
/** 下書き1件の本文の文字数の上限（登録・編集とも）。 */
export const DRAFT_BODY_MAX = 2000;
/** 1つのAccountの要確認の下書きの件数の上限。 */
export const NEEDS_REVIEW_LIMIT = 500;
/** プロンプトで作る件数の下限。 */
export const PROMPT_COUNT_MIN = 1;
/** プロンプトで作る件数の上限。 */
export const PROMPT_COUNT_MAX = 50;
/** プロンプトで作る件数の既定値。 */
export const PROMPT_COUNT_DEFAULT = 30;
/** プロンプトに含める参考投稿の件数の上限。 */
export const PROMPT_REFERENCE_POSTS = 10;
/** プロンプトに含める直近の下書きの件数の上限。 */
export const PROMPT_RECENT_DRAFTS = 20;
/** プロンプトの長さの目安（これを超えたら、下書き → 参考投稿の順に古いものから減らす）。 */
export const PROMPT_LENGTH_TARGET = 30000;
