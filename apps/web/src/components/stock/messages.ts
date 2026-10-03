// 投稿ストックの画面の文言（specs/003 contracts/ui-routes.md「エラー文言」）。
import { NEEDS_REVIEW_LIMIT } from "@threads-grower/shared";

/** 要確認の下書きが上限に達したときの文言（一覧の上の案内と、登録の 409 ITEM_LIMIT_REACHED）。 */
export const STOCK_LIMIT_MESSAGE = `要確認の下書きが上限（${NEEDS_REVIEW_LIMIT}件）に達しています。不要な下書きを削除してから登録してください。`;
