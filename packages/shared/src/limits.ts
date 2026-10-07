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

// ---- 承認・却下・NGワード（specs/004-review-approval research.md R6・R8・R9・R11・R12）----

/** 1つのAccountの承認済みの下書きの件数の上限。 */
export const APPROVED_LIMIT = 500;
/** 一覧のAPIで返す却下の下書きの件数（新しい順）。 */
export const REJECTED_LIST_MAX = 500;
/** 1回の状態の変更で送れる下書きの件数。 */
export const REVIEW_MAX_ITEMS = 500;
/** 1つのAccountのNGワードの件数の上限。 */
export const NG_WORD_LIMIT = 200;
/** NGワード1語の文字数の上限。 */
export const NG_WORD_MAX = 50;
/** 投稿ルール（CORE RULES）の文字数の上限。 */
export const CORE_RULES_MAX = 2000;
/** 却下理由の自由記述の文字数の上限。 */
export const REJECT_NOTE_MAX = 200;
/** プロンプトに含める却下の下書きの件数。 */
export const PROMPT_REJECTED_DRAFTS = 10;
/** 類似度の警告の閾値（%）。 */
export const SIMILARITY_THRESHOLD = 80;
/** 類似度を求める本文の長さの下限（正規化した後の文字数）。 */
export const SIMILARITY_MIN_LENGTH = 10;
/** 似ている相手として出す件数。 */
export const SIMILARITY_TOP_MATCHES = 3;
/** 編集距離を求める本文の長さの上限（正規化した後）。超える組はDice係数だけで判定する。 */
export const SIMILARITY_EDIT_DISTANCE_MAX_LENGTH = 300;

// ---- 自動投稿（specs/005-auto-post contracts/auto-post-job.md「定数」）----

/** 1日に投稿する時刻の上限（FR-001）。 */
export const AUTOPOST_SLOT_LIMIT = 10;
/** 時刻をずらすときの、時刻どうしの間（分。FR-001a）。 */
export const AUTOPOST_MIN_GAP_MINUTES = 30;
/** ずらす幅（秒。前後10分）。 */
export const AUTOPOST_JITTER_SECONDS = 600;
/** 予定を過ぎても投稿してよい幅（分。FR-011）。 */
export const AUTOPOST_LATE_WINDOW_MINUTES = 60;
/** 1つの時刻の中でのやり直しの回数（FR-013）。 */
export const AUTOPOST_RETRY_MAX = 3;
/** やり直しまでの間（分。1回目・2回目・3回目）。 */
export const AUTOPOST_RETRY_DELAYS_MINUTES = [5, 10, 15] as const;
/** 24時間の投稿の上限（FR-017）。 */
export const AUTOPOST_DAILY_API_LIMIT = 250;
/** 1回の定期処理で進める試みの数（Workers Freeのサブリクエストの上限のため。research.md R3）。 */
export const AUTOPOST_MAX_PER_TICK = 4;
/** 試みを進める処理の持ち時間（秒）。 */
export const AUTOPOST_LEASE_SECONDS = 120;
/** 関所の待ちの上限（分。research.md R3）。 */
export const AUTOPOST_GATE_MAX_SLEEP_MINUTES = 1440;
/** これを超える遅れ（分）で warn を出す（SC-004）。 */
export const AUTOPOST_LATE_WARN_MINUTES = 10;
/** 結果がわからない投稿を探し続ける時間（時間。research.md R6）。 */
export const AUTOPOST_FIND_PUBLISHED_HOURS = 24;
/** 結果がわからない投稿を探すとき、公開を送った時刻より前に見てよい幅（秒。Threadsとの時計のずれ。R6）。 */
export const AUTOPOST_RECONCILE_SKEW_SECONDS = 60;
/**
 * 結果を確かめられず待機にした試みを、次に確かめるまでの間の最小（分。research.md R6）。
 * 間は試みの古さの1/4をこの範囲に収める。最初は次の回（5分ごと）に確かめ、解決しない試みほど間をあける。
 */
export const AUTOPOST_RECHECK_MIN_MINUTES = 4;
/** 結果を確かめられず待機にした試みを、次に確かめるまでの間の最大（分）。 */
export const AUTOPOST_RECHECK_MAX_MINUTES = 60;
/** 投稿のURLの取り直しに失敗した投稿を、次に取り直すまでの間（分。contracts/auto-post-job.md 手順5）。 */
export const AUTOPOST_PERMALINK_RETRY_MINUTES = 60;
/** 投稿の試みを残す日数（日次の処理で、これより古い行を消す）。 */
export const AUTOPOST_ATTEMPT_RETENTION_DAYS = 30;
/** 設定の画面で深夜の案内を出す時間帯（0時からの分。2:00〜4:59。終わりは含まない。FR-001b）。 */
export const LATE_NIGHT_HINT_MINUTES = [120, 300] as const;
/** 投稿済みの一覧の1回の件数（research.md R14）。 */
export const PUBLISHED_PAGE_SIZE = 50;
