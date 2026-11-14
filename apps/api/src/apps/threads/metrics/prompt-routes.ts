// /api/threads/accounts/:accountId/prompt と /prompt-settings（specs/003-prompt-bulk-register contracts/api.md）
import {
  PROMPT_COUNT_MAX,
  PROMPT_COUNT_MIN,
  putPromptSettingsRequestSchema,
  type PostLengthSettings,
} from "@meguru/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../../platform";
import { createDb } from "../../../kernel/db/client";
import { accounts } from "../schema";
import { authorizeAccount } from "../access/access";
import { recordActivity, updatedByOf, withActivityTx } from "../activity/activity-log";
import { AppError, notFound } from "../../../kernel/errors";
import { getPrompt, lengthSettingsOf } from "./prompt-service";

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
 * PUT /prompt-settings の本文を確かめる。違反は 400 VALIDATION_FAILED で、項目名は位置つき（length.longRatio など）、
 * 割合の合計・目標を超える長さは reason を添える（specs/014 FR-142、contracts/api.md）。
 * @param body - リクエストの本文
 * @returns 検証済みの値
 */
async function parseSettings(body: Promise<unknown>) {
  const parsed = putPromptSettingsRequestSchema.safeParse(await body.catch(() => null));
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues;
  const fields = [...new Set(issues.map((i) => i.path.join(".")).filter(Boolean))];
  const reason = issues.map((i) => i.message).find((m) => m === "ratio_sum" || m === "length_over_target");
  throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, fields, reason ? { reason } : undefined);
}

const sameLength = (a: PostLengthSettings, b: PostLengthSettings) =>
  (Object.keys(a) as (keyof PostLengthSettings)[]).every((k) => a[k] === b[k]);

/**
 * プロンプトと作る件数のルート。「権限の判定 → 入力の検証」の順で確かめる（読むだけのときの制限は authorizeAccount。specs/013）。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function promptRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/prompt", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "view", { feature: "autopost" });
      const account = access.account;
      const count = parseCount(c.req.query("count")) ?? account.promptPostCount;
      const dailyPostLimit = access.ownerDailyPostLimit;
      return c.json(await getPrompt(db, account, count, access.features, dailyPostLimit));
    })
    .put("/accounts/:accountId/prompt-settings", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      // 作る件数は設定（オーナーだけ。specs/011 contracts/permissions.md、PR #14 のCodexレビュー）
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "settings", { feature: "autopost" });
      const account = access.account;
      const { postCount, length, expectedVersion } = await parseSettings(c.req.json());
      const before = lengthSettingsOf(account);
      // 読み込んだときの版が一致するときだけ保存する（黙って上書きしない。specs/008 FR-007、PR #9 のCodexレビュー）。
      // 保存と操作の記録は同じトランザクションにする
      const saved = await withActivityTx(c.env.DATABASE_URL, db, access, async (q) => {
        const [row] = await q
          .update(accounts)
          .set({
            promptPostCount: postCount,
            // 文字数と割合（省略なら変えない。specs/014 FR-140）
            ...(length && {
              postLengthTarget: length.target,
              shortLength: length.shortLength,
              mediumLength: length.mediumLength,
              longLength: length.longLength,
              shortRatio: length.shortRatio,
              mediumRatio: length.mediumRatio,
              longRatio: length.longRatio,
            }),
            promptPostCountVersion: sql`${accounts.promptPostCountVersion} + 1`,
            promptPostCountUpdatedByUserId: access.actor.id,
            updatedAt: new Date(),
          })
          .where(and(eq(accounts.id, account.id), eq(accounts.promptPostCountVersion, expectedVersion)))
          .returning();
        if (row) {
          // 変わったものだけ記録する（014で文字数・割合を足した。件数だけの保存は今のまま記録する）
          const lengthChanged = !!length && !sameLength(length, before);
          if (postCount !== account.promptPostCount || !lengthChanged)
            await recordActivity(q, access, { kind: "content", action: "prompt_count_saved", summary: `${postCount}件` });
          if (lengthChanged)
            await recordActivity(q, access, {
              kind: "content",
              action: "prompt_length_saved",
              summary: `${length.target}字・${length.shortRatio}/${length.mediumRatio}/${length.longRatio}%`,
            });
        }
        return row;
      });
      if (!saved) {
        const [current] = await db.select().from(accounts).where(eq(accounts.id, account.id)).limit(1);
        if (!current) throw notFound();
        throw new AppError(
          "STALE_UPDATE",
          409,
          "updated elsewhere",
          { postCount: current.promptPostCount, length: lengthSettingsOf(current), version: current.promptPostCountVersion },
          undefined,
          { updatedBy: await updatedByOf(db, current.promptPostCountUpdatedByUserId) },
        );
      }
      return c.json({ postCount: saved.promptPostCount, length: lengthSettingsOf(saved), version: saved.promptPostCountVersion });
    });
}
