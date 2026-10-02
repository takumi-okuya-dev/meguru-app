// Metaからの callback（contracts/api.md「Metaからのcallback」、research.md R7）。
// どちらも application/x-www-form-urlencoded で signed_request を受け取り、App Secret で署名を検証する。失敗したら 400
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { logger } from "../lib/logger";
import { SignedRequestError, verifySignedRequest } from "../lib/signed-request";
import { createThreadsClient } from "../lib/threads-client";
import { attemptDeletion, receiveDeletion } from "../services/data-deletion";
import { handleUninstall } from "../services/revocation";
import { createDb } from "../db/client";
import { threadsDeletionRequests } from "../db/schema";
import { eq } from "drizzle-orm";

async function readSignedRequest(c: { req: { parseBody: () => Promise<Record<string, unknown>> } }) {
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const sr = body.signed_request;
  return typeof sr === "string" ? sr : null;
}

/**
 * Meta からの callback（アンインストール・データ削除）のルート。signed_request を検証し、失敗したら 400。
 * @returns Hono のルート
 */
export function threadsWebhookRoutes() {
  return new Hono<AppEnv>()
    .post("/threads/webhooks/uninstall", async (c) => {
      const receivedAt = new Date();
      const sr = await readSignedRequest(c);
      if (!sr) return c.body(null, 400);
      let payload;
      try {
        payload = await verifySignedRequest(sr, c.env.THREADS_APP_SECRET);
      } catch (err) {
        if (err instanceof SignedRequestError) return c.body(null, 400);
        throw err;
      }
      await handleUninstall(c.env, createThreadsClient(c.env), payload, receivedAt);
      return c.body(null, 200);
    })
    .post("/threads/webhooks/data-deletion", async (c) => {
      const receivedAt = new Date();
      const sr = await readSignedRequest(c);
      if (!sr) return c.body(null, 400);
      let received;
      try {
        received = await receiveDeletion(c.env, sr, receivedAt);
      } catch (err) {
        if (err instanceof SignedRequestError) return c.body(null, 400);
        throw err;
      }
      if (received.isNew) {
        // 受付の記録は単独でコミット済み。ここで中断しても Cron が回収する
        try {
          const [row] = await createDb(c.env.DATABASE_URL)
            .select({ lastAttemptedAt: threadsDeletionRequests.lastAttemptedAt })
            .from(threadsDeletionRequests)
            .where(eq(threadsDeletionRequests.confirmationCode, received.code));
          if (row) await attemptDeletion(c.env, received.code, row.lastAttemptedAt);
        } catch (err) {
          logger.error("data deletion first attempt crashed", { err });
        }
      }
      // 処理の成否にかかわらず、Meta には 200 と確認コードを返す
      const web = c.env.WEB_ORIGIN.replace(/\/$/, "");
      return c.json({ url: `${web}/data-deletion/${received.code}`, confirmation_code: received.code });
    });
}
