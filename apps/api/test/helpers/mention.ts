// 時間差のメンションのテストの材料（specs/023-delayed-mention tasks.md）。
import { neon } from "@neondatabase/serverless";
import { testEnv } from "./app";

const sql = () => neon(testEnv.DATABASE_URL);

/**
 * 下書きを入れる。
 * @param accountId - accounts.id
 * @param status - 状態
 * @returns post_drafts.id
 */
export async function draftOf(
  accountId: string,
  status: "needs_review" | "approved" | "published" = "needs_review",
  mediaId = "m1",
) {
  const [b] = (await sql()`INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found)
    VALUES (${accountId}, gen_random_uuid(), 1, true) RETURNING id`) as [{ id: string }];
  const published = status === "published";
  const [d] = (await sql()`INSERT INTO post_drafts (account_id, batch_id, position, body, status, reviewed_at, published_at, threads_media_id)
    VALUES (${accountId}, ${b.id}, 0, '本文', ${status}, ${status === "needs_review" ? null : new Date().toISOString()},
      ${published ? new Date().toISOString() : null}, ${published ? mediaId : null}) RETURNING id`) as [{ id: string }];
  return d.id;
}

