// /api/accounts/:accountId/prompt と /prompt-settings（specs/003-prompt-bulk-register contracts/api.md）
import { PROMPT_COUNT_MAX, PROMPT_COUNT_MIN, promptSettingsSchema } from "@threads-grower/shared";
import { eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { accounts } from "../db/schema";
import { AppError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { authorizeAccount } from "../services/access";
import { recordActivity } from "../services/activity-log";
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
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "content");
      const account = access.account;
      requireGrowerAccess(account, access.owner);
      const { postCount } = await parseBody(promptSettingsSchema, c.req.json());
      // 競合は検知しない（後勝ち。research.md R11）
      await db.update(accounts).set({ promptPostCount: postCount, updatedAt: new Date() }).where(eq(accounts.id, account.id));
      await recordActivity(db, access, { kind: "content", action: "prompt_count_saved", summary: `${postCount}件` });
      return c.json({ postCount });
    });
}
