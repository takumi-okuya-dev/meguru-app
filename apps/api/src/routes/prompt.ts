// /api/accounts/:accountId/prompt と /prompt-settings（specs/003-prompt-bulk-register contracts/api.md）
import { PROMPT_COUNT_MAX, PROMPT_COUNT_MIN, putPromptSettingsRequestSchema } from "@threads-grower/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { accounts } from "../db/schema";
import { AppError, notFound } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { authorizeAccount } from "../services/access";
import { recordActivity, updatedByOf, withActivityTx } from "../services/activity-log";
import { requireGrowerAccess } from "../services/grower-access";
import { getPrompt } from "../services/prompt-service";

/**
 * クエリの count を確かめる。省略なら undefined、1〜50の整数でなければ 400。
 * @param raw - クエリの値
 * @returns 作る件数
 * @throws AppError VALIDATION_FAILED（details: ["count"]）
 */
function parseCount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < PROMPT_COUNT_MIN || n > PROMPT_COUNT_MAX) {
    throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["count"]);
  }
  return n;
}

/**
 * プロンプトと作る件数のルート。どちらも grower機能（research.md R10）で、「所有 → grower機能 → 入力の検証」の順で確かめる。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function promptRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/prompt", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "view");
      const account = access.account;
      requireGrowerAccess(account, access.owner);
      const count = parseCount(c.req.query("count")) ?? account.promptPostCount;
      return c.json(await getPrompt(db, account, count));
    })
    .put("/accounts/:accountId/prompt-settings", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      // 作る件数は設定（オーナーだけ。specs/011 contracts/permissions.md、PR #14 のCodexレビュー）
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "settings");
      const account = access.account;
      requireGrowerAccess(account, access.owner);
      const { postCount, expectedVersion } = await parseBody(putPromptSettingsRequestSchema, c.req.json());
      // 読み込んだときの版が一致するときだけ保存する（黙って上書きしない。specs/008 FR-007、PR #9 のCodexレビュー）。
      // 保存と操作の記録は同じトランザクションにする
      const saved = await withActivityTx(c.env.DATABASE_URL, db, access, async (q) => {
        const [row] = await q
          .update(accounts)
          .set({
            promptPostCount: postCount,
            promptPostCountVersion: sql`${accounts.promptPostCountVersion} + 1`,
            promptPostCountUpdatedByUserId: access.actor.id,
            updatedAt: new Date(),
          })
          .where(and(eq(accounts.id, account.id), eq(accounts.promptPostCountVersion, expectedVersion)))
          .returning();
        if (row) await recordActivity(q, access, { kind: "content", action: "prompt_count_saved", summary: `${postCount}件` });
        return row;
      });
      if (!saved) {
        const [current] = await db.select().from(accounts).where(eq(accounts.id, account.id)).limit(1);
        if (!current) throw notFound();
        throw new AppError(
          "STALE_UPDATE",
          409,
          "updated elsewhere",
          { postCount: current.promptPostCount, version: current.promptPostCountVersion },
          undefined,
          { updatedBy: await updatedByOf(db, current.promptPostCountUpdatedByUserId) },
        );
      }
      return c.json({ postCount: saved.promptPostCount, version: saved.promptPostCountVersion });
    });
}
