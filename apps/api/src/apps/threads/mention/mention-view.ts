// 下書きの応答に付ける時間差のメンション（specs/023-delayed-mention contracts/api.md「下書きの応答」）。
// 一覧ごとに1回の問い合わせで読み、draft-service と mention-service の両方から使う（互いを読み込まないよう、ここに分ける）。
import { mentionDueAt, type MentionFailureReason, type MentionState, type PostMention } from "@meguru/shared";
import { inArray } from "drizzle-orm";
import type { Db, TxDb } from "../../../kernel/db/client";
import { postMentions } from "../schema";

/** post_mentions の行。 */
export type PostMentionRow = typeof postMentions.$inferSelect;

/**
 * 行を応答の形にする。
 * @param m - post_mentions の行
 * @param publishedAt - 下書きの投稿日時（投稿の前は null）
 * @param username - Accountのユーザー名（返信のURLを作る。分からなければ null）
 * @returns 応答の mention
 */
export function toPostMention(m: PostMentionRow, publishedAt: Date | null, username: string | null): PostMention {
  return {
    usernames: m.usernames,
    text: m.text,
    delayMinutes: m.delayMinutes,
    state: m.state as MentionState,
    dueAt: mentionDueAt({ delayMinutes: m.delayMinutes, sendAfter: m.sendAfter }, publishedAt)?.toISOString() ?? null,
    sentAt: m.sentAt?.toISOString() ?? null,
    failureReason: m.failureReason as MentionFailureReason | null,
    replyPermalink: m.replyMediaId && username ? `https://www.threads.com/@${username}/post/${m.replyMediaId}` : null,
  };
}

/**
 * 下書きの時間差のメンションを、まとめて読む。
 * @param db - データベース
 * @param drafts - 下書き（id と投稿日時）
 * @param username - Accountのユーザー名
 * @returns draftId から応答の mention へ
 */
export async function loadMentions(
  db: Db | TxDb,
  drafts: readonly { id: string; publishedAt: Date | null }[],
  username: string | null,
): Promise<Map<string, PostMention>> {
  if (drafts.length === 0) return new Map();
  const rows = await db
    .select()
    .from(postMentions)
    .where(inArray(postMentions.draftId, drafts.map((d) => d.id)));
  const publishedAt = new Map(drafts.map((d) => [d.id, d.publishedAt]));
  return new Map(rows.map((m) => [m.draftId, toPostMention(m, publishedAt.get(m.draftId) ?? null, username)]));
}
