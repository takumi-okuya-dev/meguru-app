// /api/accounts/:accountId/posting-schedule（specs/005-auto-post contracts/api.md）。
// 自動投稿は全プランで使えるので、grower機能は判定しない（FR-004）。
import {
  AUTOPOST_JITTER_SECONDS,
  AUTOPOST_MIN_GAP_MINUTES,
  AUTOPOST_SLOT_LIMIT,
  putPostingScheduleRequestSchema,
} from "@threads-grower/shared";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { createThreadsClient } from "../lib/threads-client";
import { parseBody } from "../lib/validate";
import { findOwnedAccount } from "../services/access";
import {
  notifyWake,
  readPostingSchedule,
  savePostingSchedule,
  toPostingSchedule,
} from "../services/posting-schedule-service";

/**
 * 応答を返した後も続けたい処理を、Workers の waitUntil に渡す。ExecutionContext がない（テストの app.request）ときは待つ。
 * @param c - Hono のコンテキスト
 * @param p - 続けたい処理
 */
async function afterResponse(c: Context<AppEnv>, p: Promise<void>): Promise<void> {
  let ctx: ExecutionContext | undefined;
  try {
    ctx = c.executionCtx as ExecutionContext;
  } catch {
    ctx = undefined;
  }
  if (ctx) ctx.waitUntil(p);
  else await p;
}

/**
 * 投稿のスケジュールのルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function postingScheduleRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/posting-schedule", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const account = await findOwnedAccount(db, c.get("user").id, c.req.param("accountId"));
      return c.json({
        schedule: toPostingSchedule(await readPostingSchedule(db, account.id)),
        limits: {
          slots: AUTOPOST_SLOT_LIMIT,
          minGapMinutes: AUTOPOST_MIN_GAP_MINUTES,
          jitterMinutes: AUTOPOST_JITTER_SECONDS / 60,
        },
      });
    })
    .put("/accounts/:accountId/posting-schedule", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const account = await findOwnedAccount(db, c.get("user").id, c.req.param("accountId"));
      const req = await parseBody(putPostingScheduleRequestSchema, c.req.json());
      const now = new Date();
      const result = await savePostingSchedule(
        c.env,
        db,
        account.id,
        req,
        createThreadsClient(c.env),
        now,
      );
      // コミットの後、定期処理に設定の変更を知らせる（research.md R3）
      await afterResponse(c, notifyWake(c.env.AUTOPOST_KV, now));
      return c.json(result);
    });
}
