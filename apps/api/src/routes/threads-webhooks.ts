// Metaからの callback（contracts/api.md「Metaからのcallback」、research.md R7）。
// どちらも application/x-www-form-urlencoded で signed_request を受け取り、App Secret で署名を検証する。失敗したら 400
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../app";
import { logger } from "../lib/logger";
import { SignedRequestError, verifySignedRequest } from "../lib/signed-request";
import { createThreadsClient } from "../lib/threads-client";
import { attemptDeletion, receiveDeletion } from "../services/data-deletion";
import { handleUninstall } from "../services/revocation";
import { createDb } from "../db/client";
import { threadsDeletionRequests } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * 本文の上限。無認証で届くので、署名を確かめる**前**に読む量を縛る。
 * 読み終えてから測らず、読みながら当てる（specs/010 verification.md:56 と同じ決まり）。
 * `signed_request` は base64url のJSONで、実測は1KB未満。8KiBは十分な余裕（セキュリティ監査 run-1）。
 *
 * `parseBody()` は Content-Type が form 系のとき本文を `arrayBuffer()` で丸ごと読んでから
 * FormData を組むので、上限を付けないと攻撃者が選んだ大きさのコピーが2つできる。
 */
const WEBHOOK_BODY_MAX_BYTES = 8192;

/** 本文が大きすぎるときは、ほかの失敗と同じく中身のない 400 を返す。 */
const limit = bodyLimit({ maxSize: WEBHOOK_BODY_MAX_BYTES, onError: (c) => c.body(null, 400) });

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
    .post("/threads/webhooks/uninstall", limit, async (c) => {
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
    .post("/threads/webhooks/data-deletion", limit, async (c) => {
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
