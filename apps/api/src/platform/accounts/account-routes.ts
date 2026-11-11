// /api/accounts/*（contracts/api.md）
import {
  createAccountRequestSchema,
  deleteAccountRequestSchema,
  openAccountRequestSchema,
  renameAccountRequestSchema,
} from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../identity/auth";
import { createDb } from "../../kernel/db/client";
import { AppError } from "../../kernel/errors";
import { authorizeAccount, summaryRoleOf, toAccountSummary, type AccountAccess } from "../access/access";
import { createAccount, deleteAccount, openAccount, renameAccount } from "./account-service";
import { runHook } from "../hooks";
import { parseBody } from "../../kernel/validate";

/**
 * 判定の結果を、ログインした人から見た AccountSummary にする（specs/011 contracts/permissions.md）。
 * @param access - authorizeAccount の結果
 * @returns AccountSummary
 */
function summaryOf(access: AccountAccess) {
  const summary = toAccountSummary(access.account, summaryRoleOf(access.relation), access.relation === "owner" ? null : access.owner.name);
  if (access.relation !== "shared_viewer") return summary;
  // 見せてもらっている人には、表示に使う名前・アイコンだけを渡し、プラン・接続の状態と方法・最後に使った日時は伏せる
  // （読むだけの画面では使わない。型をそろえるための決まった値で、本当の値ではない。PR #14 のCodexレビュー）
  return {
    ...summary,
    plan: "auto-only" as const,
    connectionStatus: "connected" as const,
    connectionMethod: "app" as const,
    reconnectHint: null,
    lastUsedAt: null,
  };
}

/**
 * /api/accounts/* のルート。取得・open（記録と接続の確認）・削除。
 * いずれも「権限 → 入力の検証」の順で確かめる（specs/008 contracts/permissions.md）。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function accountRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .post("/accounts", authed, async (c) => {
      // 名前だけで、Threadsにつないでいないアカウントを作る（specs/012 contracts/api.md）
      const req = await parseBody(createAccountRequestSchema, c.req.json());
      const account = await createAccount(c.env, c.get("user").id, req.name);
      return c.json(toAccountSummary(account), 201);
    })
    .get("/accounts/:accountId", authed, async (c) => {
      // 副作用なし：DBに保存されている状態のまま返す
      const access = await authorizeAccount(createDb(c.env.DATABASE_URL), c.get("user"), c.req.param("accountId"), "read");
      return c.json(summaryOf(access));
    })
    .post("/accounts/:accountId/open", authed, async (c) => {
      // ページをまたいで比べられる順序値として、受け取った時点のサーバー時刻を使う（research.md R10）
      const receivedAt = new Date();
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "view");
      const parsed = openAccountRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid open request");
      await openAccount(c.env, user.id, access.account.id, parsed.data, receivedAt, access.relation === "owner");
      // アプリに知らせる（Threads：保存しているトークンで接続を確かめる。specs/027 research.md R4）
      await runHook("accountOpened", { env: c.env, accountId: access.account.id });
      return c.json(summaryOf(await authorizeAccount(db, user, access.account.id, "view")));
    })
    .patch("/accounts/:accountId", authed, async (c) => {
      // 名前を直す（オーナーだけ。specs/012 FR-040）。権限 → 入力の検証の順
      const user = c.get("user");
      await authorizeAccount(createDb(c.env.DATABASE_URL), user, c.req.param("accountId"), "owner");
      const req = await parseBody(renameAccountRequestSchema, c.req.json());
      const account = await renameAccount(c.env, user.id, c.req.param("accountId"), req.name);
      return c.json(toAccountSummary(account));
    })
    .delete("/accounts/:accountId", authed, async (c) => {
      const user = c.get("user");
      // 削除は remove（オーナーだけ。読むだけになっても消せる。specs/013 FR-042）
      await authorizeAccount(createDb(c.env.DATABASE_URL), user, c.req.param("accountId"), "remove");
      const parsed = deleteAccountRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid delete request");
      await deleteAccount(c.env, user.id, c.req.param("accountId"), parsed.data.confirmName);
      return c.body(null, 204);
    });
}
