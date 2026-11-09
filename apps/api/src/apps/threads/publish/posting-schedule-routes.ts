// /api/accounts/:accountId/posting-schedule（specs/005-auto-post contracts/api.md）。
// 自動投稿は全プランで使えるので、grower機能は判定しない（FR-004）。
import {
  AUTOPOST_JITTER_SECONDS,
  AUTOPOST_MIN_GAP_MINUTES,
  putPostingScheduleRequestSchema,
} from "@threads-grower/shared";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../../platform";
import { createDb } from "../../../kernel/db/client";
import { createThreadsClient } from "../../../adapters/threads-api";
import { parseBody } from "../../../kernel/validate";
import { authorizeAccount, effectiveLimits } from "../../../platform";
import {
  notifyWake,
  readPostingSchedule,
  savePostingSchedule,
  toPostingSchedule,
} from "./posting-schedule-service";

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
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "view", { feature: "autopost" });
      const account = access.account;
      // 1日の投稿数の上限はオーナーの値（運営者は Threads の上限まで。specs/024 FR-019）
      const [schedule, limits] = await Promise.all([readPostingSchedule(db, account.id), effectiveLimits(db, c.env, access.owner.id)]);
      return c.json({
        schedule: toPostingSchedule(schedule),
        // 上限が下がって、登録した時刻の数が上限を超えている（画面の注意。FR-020）
        overLimit: (schedule?.slotMinutes.length ?? 0) > limits.dailyPostLimit,
        limits: {
          slots: limits.dailyPostLimit,
          minGapMinutes: AUTOPOST_MIN_GAP_MINUTES,
          jitterMinutes: AUTOPOST_JITTER_SECONDS / 60,
        },
      });
    })
    .put("/accounts/:accountId/posting-schedule", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "settings", { feature: "autopost" });
      const account = access.account;
      const req = await parseBody(putPostingScheduleRequestSchema, c.req.json());
      const now = new Date();
      const result = await savePostingSchedule(
        c.env,
        db,
        account.id,
        req,
        createThreadsClient(c.env),
        now,
        access,
        (await effectiveLimits(db, c.env, access.owner.id)).dailyPostLimit,
      );
      // コミットの後、定期処理に設定の変更を知らせる（research.md R3）。時刻は保存が終わった後のもの
      // （接続の確認の間に定期処理の回が終わっていても、その回より新しい知らせにする）
      await afterResponse(c, notifyWake(c.env.AUTOPOST_KV, new Date()));
      return c.json(result);
    });
}
