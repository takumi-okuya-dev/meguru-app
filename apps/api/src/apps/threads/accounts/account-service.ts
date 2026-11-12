// Accountの作成・更新・上限（FR-008〜FR-017、research.md R8・R9）。Threadsとの接続は connection-service（specs/027）。
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Env } from "../../../kernel/env";
import { createDb, withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import { lockUserRow } from "../../../kernel/db/locks";
import { accounts, memberships } from "../schema";
import { users } from "../../../platform/schema";
import { billingModeOf, type BillingMode } from "../../../kernel/config";
import { AppError } from "../../../kernel/errors";
import { authorizeAccount } from "../access/access";
import { loadEntitlement, syncQuantity } from "../../../platform";
import { withdrawForAccountDeletion } from "../tester-invites/tester-application-service";
import { syncThreadsUsage } from "./usage";
import { recordActivity } from "../activity/activity-log";
import { beforeAccountDeleted } from "../teams/team-service";
import { effectiveLimits } from "../../../platform";

// ---- 登録数の上限（specs/013 research.md R9。001 FR-015〜FR-017 を置き換えた） ----

/**
 * ユーザーが owner として持つ Account の数（Threadsにつないでいないものも数える。specs/013 FR-013）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @returns 数
 */
export async function countOwnedAccounts(db: Db | TxDb, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")));
  return Number(row?.n ?? 0);
}

/**
 * ユーザーの登録数の上限と使用数を求める。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @param mode - 決済のモード
 * @param env - Workers のバインディング（運営者の判定。specs/024）
 * @param now - 今の時刻
 * @returns 上限（max。null は上限なし、0 は作れない）、使用数（used）、使える状態、前からの無料体験の上限が効いているか（trialBound）、
 *   運営者が決める上限（limits）
 */
export async function accountLimitFor(
  db: Db | TxDb,
  userId: string,
  mode: BillingMode,
  env: Pick<Env, "OPERATOR_CLERK_USER_IDS">,
  now: Date = new Date(),
) {
  const [entitlement, used, limits] = await Promise.all([
    loadEntitlement(db, userId, mode, now),
    countOwnedAccounts(db, userId),
    effectiveLimits(db, env, userId),
  ]);
  // 使える状態の上限（前からの無料体験なら1。読むだけ・契約前なら0）と、運営者が決める上限の小さい方（specs/024 FR-018）
  const byState = entitlement ? entitlement.accountLimit : 0;
  const byOperator = limits.accountLimit;
  const max = byState === null ? byOperator : byOperator === null ? byState : Math.min(byState, byOperator);
  // 前からの無料体験の上限が効いているか（エラーの文で契約を案内する）
  const trialBound = entitlement?.state === "trial" && max === byState;
  return { max, used, entitlement, trialBound, limits };
}

/**
 * 新しい Account を追加できるかを確かめる（specs/013 FR-010・FR-011・FR-043）。
 * 読むだけなら BILLING_REQUIRED、無料体験中で上限に達していれば ACCOUNT_LIMIT_REACHED。
 * 上限を超えて持っている（このfeatureの前に作った）アカウントは消さない（FR-014）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @param mode - 決済のモード
 * @param env - Workers のバインディング（運営者の判定。specs/024）
 * @returns 上限・使用数
 * @throws AppError BILLING_REQUIRED・ACCOUNT_LIMIT_REACHED
 */
export async function assertCanAddAccount(db: Db | TxDb, userId: string, mode: BillingMode, env: Pick<Env, "OPERATOR_CLERK_USER_IDS">) {
  const limit = await accountLimitFor(db, userId, mode, env);
  const e = limit.entitlement;
  if (e && !e.fullAccess) {
    throw new AppError("BILLING_REQUIRED", 403, "billing required", undefined, [e.readOnlyReason ?? "trial_ended"]);
  }
  if (limit.max !== null && limit.used >= limit.max) {
    throw new AppError("ACCOUNT_LIMIT_REACHED", 409, "account limit reached", undefined, limit.trialBound ? ["trial"] : undefined, {
      max: limit.max,
    });
  }
  return limit;
}

// ---- アカウントを作る（specs/012 research.md R3） ----

/**
 * 名前だけで、Threadsにつないでいないアカウントを作る（specs/012 FR-002〜FR-004）。
 * 利用者の行に鍵をかけて上限を数え直し、アカウントとオーナーの Membership を同じトランザクションで作る。
 * 初期の設定（宣伝投稿の割合・プロンプトで作る件数など）は列の既定値で、つないで作っていたときと同じ。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param name - アカウントの名前（前後の空白を除いたもの）
 * @returns 作ったアカウントの行
 * @throws AppError ACCOUNT_LIMIT_REACHED
 */
export async function createAccount(env: Env, userId: string, name: string) {
  const created = await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockUserRow(tx, userId);
    await assertCanAddAccount(tx, userId, billingModeOf(env), env);
    const [account] = await tx
      .insert(accounts)
      .values({
        name,
        connectionStatus: "not_connected",
        connectionMethod: null,
      })
      .returning();
    await tx.insert(memberships).values({ userId, accountId: account!.id, role: "owner" });
    return account!;
  });
  // トランザクションの後で、利用の数を共通へ伝え（料金の数が変われば印が付く）、Stripeの数を合わせる。
  // 失敗しても作成は成功のまま（印が残り、日次で合わせる。specs/meguru/029 research.md R6）
  await syncThreadsUsage(createDb(env.DATABASE_URL), userId);
  await syncQuantity(env, userId);
  return created;
}

// ---- 最後に開いたアカウント（Threadsとの接続の確定は apps/threads/connection/connection-service.ts。specs/027） ----

/**
 * 「最後に使ったAccount」を記録する（FR-007、research.md R10）。
 * 1つの条件付き UPDATE で、(a) receivedAt が記録以前のもの、(b) 同じ clientId で openSeq が記録以下のもの、を反映しない。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param accountId - 開いた Account の ID
 * @param req - ページごとの乱数ID（clientId）と連番（openSeq）
 * @param receivedAt - サーバーがリクエストを受け取った時刻
 * @param touchAccount - オーナーのときだけ accounts.last_used_at を変える（specs/008 research.md R11）
 * @returns 記録を更新したら true。古いリクエストで反映しなかったら false
 */
export async function openAccount(
  env: Env,
  userId: string,
  accountId: string,
  req: { clientId: string; openSeq: number },
  receivedAt: Date,
  /** オーナーのときだけ accounts.last_used_at を変える（手伝う人の操作でオーナーの並びを動かさない。specs/008 research.md R11） */
  touchAccount = true,
): Promise<boolean> {
  const db = createDb(env.DATABASE_URL);
  const updated = await db
    .update(users)
    .set({
      lastAccountId: accountId,
      lastAccountClientId: req.clientId,
      lastAccountOpenSeq: req.openSeq,
      lastAccountOpenReceivedAt: receivedAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(users.id, userId),
        or(
          isNull(users.lastAccountOpenReceivedAt),
          lt(users.lastAccountOpenReceivedAt, receivedAt),
        ),
        or(
          isNull(users.lastAccountClientId),
          ne(users.lastAccountClientId, req.clientId),
          isNull(users.lastAccountOpenSeq),
          lt(users.lastAccountOpenSeq, req.openSeq),
        ),
      ),
    )
    .returning({ id: users.id });
  if (updated.length === 0) return false;
  if (touchAccount) await db.update(accounts).set({ lastUsedAt: receivedAt }).where(eq(accounts.id, accountId));
  return true;
}

// ---- 名前を直す（specs/012 FR-040） ----

/**
 * アカウントの名前を直す。オーナーだけ。チームに入っているアカウントでは、前後の名前を操作の記録に残す。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param accountId - accounts.id
 * @param name - 新しい名前（前後の空白を除いたもの）
 * @returns 直した後の Account の行
 * @throws AppError ACCOUNT_NOT_FOUND・ROLE_FORBIDDEN
 */
export async function renameAccount(env: Env, userId: string, accountId: string, name: string) {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    const access = await authorizeAccount(tx, { id: userId, billing: billingModeOf(env) }, accountId, "owner");
    const from = access.account.name;
    const [row] = await tx
      .update(accounts)
      .set({ name, updatedAt: new Date() })
      .where(eq(accounts.id, access.account.id))
      .returning();
    if (from !== name) {
      await recordActivity(tx, access, { kind: "settings", action: "account_renamed", details: { from, to: name } });
    }
    return row!;
  });
}

// ---- Accountの削除（FR-022、research.md R13） ----

/**
 * Account を削除する（FR-022、research.md R13）。
 * 1つのトランザクションで users の行をロックし、last_account_deleted_at を記録してから削除する。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param accountId - 削除する Account の ID
 * @param confirmName - 確認のために入力されたアカウントの名前（前後の空白は問わない。specs/012 FR-043）
 * @throws AppError ACCOUNT_NOT_FOUND・CONFIRMATION_MISMATCH
 */
export async function deleteAccount(
  env: Env,
  userId: string,
  accountId: string,
  confirmName: string,
) {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockUserRow(tx, userId);
    const { account } = await authorizeAccount(tx, { id: userId, billing: billingModeOf(env) }, accountId, "remove");
    if (!confirmName.trim() || confirmName.trim() !== account.name) {
      throw new AppError("CONFIRMATION_MISMATCH", 422, "confirmation does not match");
    }
    // チームの最後のアカウントなら、同じトランザクションでチームを抜けたものとする（specs/011 FR-046、research.md R7）
    await beforeAccountDeleted(tx, account.id, userId);
    // テスター招待の申し込みを取り下げ、枠を使っていれば「外してよい」にする（specs/024 data-model.md 5）
    await withdrawForAccountDeletion(tx, account.id);
    const now = new Date();
    await tx
      .update(users)
      .set({ lastAccountDeletedAt: now, updatedAt: now })
      .where(eq(users.id, userId));
    await tx.delete(accounts).where(eq(accounts.id, account.id));
  });
  // 利用の数を共通へ伝え、次の請求から数を減らす（日割りの返金はしない。specs/013 FR-030）
  await syncThreadsUsage(createDb(env.DATABASE_URL), userId);
  await syncQuantity(env, userId);
}

/**
 * Threadsのユーザーで、そのアカウントをすべて消す（Metaからのデータ削除の求め。specs/001 research.md R13）。
 * 持ち主ごとに users の行をロックし、チームの片づけ・アプリの片づけ（知らせ）・最後に消した日時・数の合わせ直しの印をしてから消す。
 * 029 で Threads の持ち物にした。トランザクションの中で呼び、返した持ち主について、トランザクションのあとで利用の数を伝える。
 * @param tx - トランザクション
 * @param threadsUserId - accounts.threads_user_id
 * @param now - 削除の時刻
 * @returns 消したアカウントの持ち主の users.id
 */
export async function deleteAccountsOfThreadsUser(tx: TxDb, threadsUserId: string, now: Date): Promise<string[]> {
  const owners = await tx
    .select({ userId: memberships.userId, accountId: accounts.id })
    .from(accounts)
    .innerJoin(memberships, and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")))
    .where(eq(accounts.threadsUserId, threadsUserId));
  for (const o of owners) {
    await lockUserRow(tx, o.userId);
    // チームの最後のアカウントなら、チームを抜けたものとする（specs/011 FR-046。アカウントの削除と同じ）
    await beforeAccountDeleted(tx, o.accountId, o.userId);
    // テスター招待の取り下げ（specs/024 data-model.md 5、PR #71 のCodexレビュー）
    await withdrawForAccountDeletion(tx, o.accountId);
    await tx.update(users).set({ lastAccountDeletedAt: now, updatedAt: now }).where(eq(users.id, o.userId));
  }
  await tx.delete(accounts).where(eq(accounts.threadsUserId, threadsUserId));
  // 持ち主（トランザクションのあとで、呼んだ側が利用の数を共通へ伝える。specs/meguru/029 research.md R6）
  return [...new Set(owners.map((o) => o.userId))];
}
