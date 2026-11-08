// テスター招待の申し込み（specs/024-tester-invite-connect research.md R1〜R5・R14・R15、data-model.md 1-1・5）。
// 申し込みの読み書きはこのファイルの外に書かない。接続・アカウントの削除・退会は、ここの関数を同じトランザクションで呼ぶ。
import {
  LIVE_TESTER_APPLICATION_STATUSES,
  TESTER_APPLICATIONS_LIST_LIMIT,
  TESTER_APPLY_RATE,
  normalizeThreadsUsername,
  normalizeUsername,
  type OperatorTesterApplication,
  type OperatorTesterApplications,
  type TesterApplication,
  type TesterApplicationView,
  type TesterRemovalReason,
} from "@threads-grower/shared";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import type { Env } from "../env";
import { createDb, withTransaction, type Db, type TxDb } from "../db/client";
import { lockUserRow } from "../db/locks";
import { accounts, operatorSettings, testerApplications, users } from "../db/schema";
import { billingModeOf, testerInvitesEnabledOf, threadsAppIdOf } from "../lib/config";
import { AppError, pgErrorCode } from "../lib/errors";
import { authorizeAccount, isUuid } from "./access";
import { countRecentApplyActions, recordOperatorEvent } from "./operator-events";

type Row = typeof testerApplications.$inferSelect;

const notPending = () => new AppError("TESTER_APPLICATION_NOT_PENDING", 409, "application state does not allow this");
const disabled = () => new AppError("ITEM_NOT_FOUND", 404, "tester invites disabled");

/**
 * 招待の管理がOFFなら 404 にする（research.md R4）。
 * @param env - Workers のバインディング
 * @throws AppError 404
 */
export function assertTesterInvitesEnabled(env: Env): void {
  if (!testerInvitesEnabledOf(env)) throw disabled();
}

/**
 * 利用者に見せる形にする。
 * @param r - 申し込みの行
 * @returns 申し込み
 */
function toApplication(r: Row): TesterApplication {
  return {
    id: r.id,
    threadsUsername: r.threadsUsername,
    status: r.status as TesterApplication["status"],
    declineReason: r.declineReason,
    createdAt: r.createdAt.toISOString(),
    statusChangedAt: r.statusChangedAt.toISOString(),
  };
}

/**
 * アカウントの、いちばん新しい申し込み（取り下げだけなら null。contracts/api.md）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param accountId - accounts.id
 * @returns 申し込み。なければ null
 */
export async function getApplication(db: Db | TxDb, accountId: string): Promise<TesterApplication | null> {
  const [row] = await db
    .select()
    .from(testerApplications)
    .where(eq(testerApplications.accountId, accountId))
    .orderBy(desc(testerApplications.createdAt))
    .limit(1);
  if (!row || row.status === "withdrawn") return null;
  return toApplication(row);
}

/**
 * 生きている申し込み（アカウント1件に1つまで）を、行ロックをかけて読む。
 * @param tx - トランザクション
 * @param accountId - accounts.id
 * @returns 行。なければ undefined
 */
async function liveFor(tx: TxDb, accountId: string): Promise<Row | undefined> {
  const [row] = await tx
    .select()
    .from(testerApplications)
    .where(and(eq(testerApplications.accountId, accountId), inArray(testerApplications.status, [...LIVE_TESTER_APPLICATION_STATUSES])))
    .for("update")
    .limit(1);
  return row;
}

/**
 * 回数の制限（10分に5回。FR-006）。
 * @param tx - トランザクション
 * @param userId - users.id
 * @throws AppError RATE_LIMITED
 */
async function assertRate(tx: TxDb, userId: string): Promise<void> {
  const since = new Date(Date.now() - TESTER_APPLY_RATE.windowMinutes * 60_000);
  if ((await countRecentApplyActions(tx, userId, since)) >= TESTER_APPLY_RATE.count) {
    throw new AppError("RATE_LIMITED", 429, "too many apply actions");
  }
}

/**
 * 申し込む（FR-004・FR-005）。
 * @param env - Workers のバインディング
 * @param user - 申し込む人
 * @param accountId - accounts.id（オーナーだけ）
 * @param rawUsername - 入力されたユーザー名
 * @returns 作った申し込み
 * @throws AppError VALIDATION_FAILED・TESTER_APPLICATION_EXISTS・RATE_LIMITED・ACCOUNT_NOT_FOUND
 */
export async function apply(env: Env, user: { id: string }, accountId: string, rawUsername: string): Promise<TesterApplication> {
  assertTesterInvitesEnabled(env);
  const username = normalizeThreadsUsername(rawUsername);
  if (!username) throw new AppError("VALIDATION_FAILED", 400, "invalid threads username", undefined, ["threadsUsername"]);
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockUserRow(tx, user.id);
    const { account } = await authorizeAccount(tx, { id: user.id, billing: billingModeOf(env) }, accountId, "owner");
    if (account.connectionStatus !== "not_connected") {
      throw new AppError("VALIDATION_FAILED", 400, "account already connected", undefined, ["accountId"]);
    }
    await assertRate(tx, user.id);
    if (await liveFor(tx, account.id)) throw new AppError("TESTER_APPLICATION_EXISTS", 409, "application exists");
    let row: Row;
    try {
      [row] = (await tx
        .insert(testerApplications)
        .values({ userId: user.id, accountId: account.id, threadsUsername: username })
        .returning()) as [Row];
    } catch (err) {
      if (pgErrorCode(err) === "23505") throw new AppError("TESTER_APPLICATION_EXISTS", 409, "application exists");
      throw err;
    }
    await recordOperatorEvent(tx, { actorUserId: user.id, subjectUserId: user.id, applicationId: row.id, action: "apply" });
    return toApplication(row);
  });
}

/**
 * 取り消す（FR-006）。申し込み中は理由なしの取り下げ、招待済みは「外してよい」になる取り下げ。
 * @param env - Workers のバインディング
 * @param user - 申し込んだ人
 * @param accountId - accounts.id（オーナーだけ）
 * @throws AppError TESTER_APPLICATION_NOT_PENDING・RATE_LIMITED・ACCOUNT_NOT_FOUND
 */
export async function cancel(env: Env, user: { id: string }, accountId: string): Promise<void> {
  assertTesterInvitesEnabled(env);
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockUserRow(tx, user.id);
    const { account } = await authorizeAccount(tx, { id: user.id, billing: billingModeOf(env) }, accountId, "owner");
    const live = await liveFor(tx, account.id);
    if (!live || (live.status !== "pending" && live.status !== "invited")) throw notPending();
    await assertRate(tx, user.id);
    await setStatus(tx, live.id, {
      status: "withdrawn",
      removalReason: live.holdsSlot ? "withdrawn" : null,
    });
    await recordOperatorEvent(tx, { actorUserId: user.id, subjectUserId: user.id, applicationId: live.id, action: "cancel" });
  });
}

/**
 * 状態を変える（状態が変わった日時も更新する）。
 * @param tx - トランザクション
 * @param id - tester_applications.id
 * @param values - 変える値
 */
async function setStatus(tx: TxDb, id: string, values: Partial<typeof testerApplications.$inferInsert>): Promise<void> {
  const now = new Date();
  await tx
    .update(testerApplications)
    .set({ ...values, statusChangedAt: now, updatedAt: now })
    .where(eq(testerApplications.id, id));
}

// ---- 接続・アカウントの削除・退会（research.md R5・R15） ----

/**
 * つないだときに、そのアカウントの生きている申し込みを進める（completeConnection のトランザクションの中で呼ぶ）。
 * Threadsで許可する（app）でユーザー名が同じなら接続済み、違えば外してよい。トークンなら取り下げ。
 * @param tx - トランザクション
 * @param input - アカウント・つないだ方法・つながったThreadsのユーザー名
 */
export async function advanceOnConnect(
  tx: TxDb,
  input: { accountId: string; method: "app" | "token"; username: string },
): Promise<void> {
  const live = await liveFor(tx, input.accountId);
  if (!live) return;
  const connected = normalizeUsername(input.username);
  if (input.method === "app") {
    if (live.status === "connected") return;
    if (connected === live.threadsUsername) {
      await setStatus(tx, live.id, { status: "connected", holdsSlot: true, connectedUsername: connected });
      return;
    }
    // 違うアカウントでつながった（そのアカウントもテスター）。申し込んだユーザー名の枠を外してよいにする
    await setStatus(tx, live.id, {
      status: "withdrawn",
      removalReason: live.holdsSlot ? "username_mismatch" : null,
      connectedUsername: connected,
    });
    return;
  }
  await setStatus(tx, live.id, {
    status: "withdrawn",
    removalReason: live.holdsSlot ? "token_connected" : null,
    connectedUsername: connected,
  });
}

/**
 * アカウントを消す前に、生きている申し込みを取り下げにする（枠を使っていれば「外してよい」）。
 * @param tx - トランザクション
 * @param accountId - 消すアカウント
 */
export async function withdrawForAccountDeletion(tx: TxDb, accountId: string): Promise<void> {
  const live = await liveFor(tx, accountId);
  if (!live) return;
  await setStatus(tx, live.id, { status: "withdrawn", removalReason: live.holdsSlot ? "account_deleted" : null });
}

/**
 * 退会の前に、申し込みを片づける（research.md R15）。枠を使っていない行は消し、枠を使っている行は
 * Threadsのユーザー名だけを残して「外してよい」（user_withdrawn）にする。
 * @param tx - トランザクション
 * @param userId - 退会する人
 */
export async function purgeForWithdrawal(tx: TxDb, userId: string): Promise<void> {
  await tx.delete(testerApplications).where(and(eq(testerApplications.userId, userId), eq(testerApplications.holdsSlot, false)));
  const now = new Date();
  await tx
    .update(testerApplications)
    .set({
      status: "withdrawn",
      removalReason: sql`coalesce(${testerApplications.removalReason}, 'user_withdrawn')`,
      declineReason: null,
      // 違うアカウントでつながったときのユーザー名も残さない（外すのに要るのは申し込んだユーザー名だけ。PR #71 のCodexレビュー）
      connectedUsername: null,
      statusChangedAt: now,
      updatedAt: now,
    })
    .where(and(eq(testerApplications.userId, userId), eq(testerApplications.holdsSlot, true)));
}

// ---- 運営者（US2。contracts/api.md「運営者の招待の管理」） ----

/** 「外してよい」の条件。 */
const removable = and(eq(testerApplications.holdsSlot, true), isNotNull(testerApplications.removalReason));

/**
 * 一覧の見え方ごとの条件と並び。
 * @param view - 見え方
 * @returns 条件と並び
 */
function viewOf(view: TesterApplicationView): { where: SQL | undefined; order: SQL[] } {
  const changed = desc(testerApplications.statusChangedAt);
  switch (view) {
    case "pending":
      return { where: eq(testerApplications.status, "pending"), order: [asc(testerApplications.createdAt)] };
    case "invited":
      return { where: eq(testerApplications.status, "invited"), order: [changed] };
    case "connected":
      return { where: eq(testerApplications.status, "connected"), order: [changed] };
    case "removable":
      return { where: removable, order: [changed] };
    case "closed":
      return {
        where: and(inArray(testerApplications.status, ["declined", "withdrawn"]), eq(testerApplications.holdsSlot, false)),
        order: [changed],
      };
  }
}

/**
 * 運営者が決める値（1行だけ）。
 * @param db - データベース（トランザクションの中でもよい）
 * @returns 行
 */
export async function readOperatorSettings(db: Db | TxDb) {
  const [row] = await db.select().from(operatorSettings).where(eq(operatorSettings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db.insert(operatorSettings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(operatorSettings).where(eq(operatorSettings.id, 1)).limit(1))[0]!;
}

/**
 * テスター枠の使用数（SC-005：holds_slot の数と一致）。
 * @param db - データベース（トランザクションの中でもよい）
 * @returns 使用数
 */
export async function slotUsage(db: Db | TxDb): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(testerApplications).where(eq(testerApplications.holdsSlot, true));
  return Number(row?.n ?? 0);
}

/**
 * 運営者の一覧（FR-008・FR-010・FR-012）。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param view - 見え方
 * @returns 一覧
 */
export async function listForOperator(env: Env, db: Db, view: TesterApplicationView): Promise<OperatorTesterApplications> {
  const v = viewOf(view);
  const rows = await db
    .select({ app: testerApplications, name: users.displayName, email: users.email })
    .from(testerApplications)
    .leftJoin(users, eq(users.id, testerApplications.userId))
    .where(v.where)
    .orderBy(...v.order)
    .limit(TESTER_APPLICATIONS_LIST_LIMIT);
  const [settings, used, counts] = await Promise.all([readOperatorSettings(db), slotUsage(db), countsOf(db)]);
  const names = [...new Set(rows.map((r) => r.app.threadsUsername))];
  const [dups, connected] = names.length === 0 ? [[], []] : await Promise.all([liveUsernames(db, names), connectedUsernames(db, names)]);
  return {
    enabled: testerInvitesEnabledOf(env),
    threadsAppId: threadsAppIdOf(env),
    slots: { used, capacity: settings.testerSlotCapacity },
    counts,
    items: rows.map((r) => toOperatorItem(r, dups, connected)),
  };
}

/**
 * 一覧の1行にする。
 * @param r - 行と申し込んだ人
 * @param dups - 生きている申し込みのユーザー名と申し込みID
 * @param connected - アプリにつながっているユーザー名とアカウントID
 * @returns 一覧の1行
 */
function toOperatorItem(
  r: { app: Row; name: string | null; email: string | null },
  dups: { username: string; id: string }[],
  connected: { username: string; accountId: string }[],
): OperatorTesterApplication {
  const a = r.app;
  return {
    id: a.id,
    threadsUsername: a.threadsUsername,
    status: a.status as OperatorTesterApplication["status"],
    removalReason: (a.removalReason as TesterRemovalReason | null) ?? null,
    applicant: a.userId && r.email ? { userId: a.userId, name: r.name, email: r.email } : null,
    connectedUsername: a.connectedUsername,
    declineReason: a.declineReason,
    duplicate: dups.some((d) => d.username === a.threadsUsername && d.id !== a.id),
    alreadyConnected: connected.some((c) => c.username === a.threadsUsername && c.accountId !== a.accountId),
    createdAt: a.createdAt.toISOString(),
    statusChangedAt: a.statusChangedAt.toISOString(),
  };
}

/**
 * 生きている申し込みのユーザー名（同じユーザー名の申し込みを探す。FR-012）。
 * @param db - データベース
 * @param names - ユーザー名
 * @returns ユーザー名と申し込みID
 */
async function liveUsernames(db: Db, names: string[]) {
  return db
    .select({ username: testerApplications.threadsUsername, id: testerApplications.id })
    .from(testerApplications)
    .where(
      and(
        inArray(testerApplications.threadsUsername, names),
        inArray(testerApplications.status, [...LIVE_TESTER_APPLICATION_STATUSES]),
      ),
    );
}

/**
 * アプリにつながっているアカウントのユーザー名（FR-012）。
 * @param db - データベース
 * @param names - ユーザー名
 * @returns ユーザー名（小文字）とアカウントID
 */
async function connectedUsernames(db: Db, names: string[]) {
  return db
    .select({ username: sql<string>`lower(${accounts.username})`, accountId: accounts.id })
    .from(accounts)
    .where(and(inArray(sql`lower(${accounts.username})`, names), ne(accounts.connectionStatus, "not_connected")));
}

/**
 * 状態ごとの件数。
 * @param db - データベース
 * @returns 件数
 */
async function countsOf(db: Db) {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) FILTER (WHERE ${testerApplications.status} = 'pending')::int`,
      invited: sql<number>`count(*) FILTER (WHERE ${testerApplications.status} = 'invited')::int`,
      connected: sql<number>`count(*) FILTER (WHERE ${testerApplications.status} = 'connected')::int`,
      removable: sql<number>`count(*) FILTER (WHERE ${removable})::int`,
    })
    .from(testerApplications);
  return {
    pending: Number(row?.pending ?? 0),
    invited: Number(row?.invited ?? 0),
    connected: Number(row?.connected ?? 0),
    removable: Number(row?.removable ?? 0),
  };
}

/**
 * 運営者の操作のあとの1行を読む。
 * @param db - データベース
 * @param id - tester_applications.id
 * @returns 一覧の1行（行ごと消したら null）
 */
async function operatorItem(db: Db, id: string): Promise<OperatorTesterApplication | null> {
  const [r] = await db
    .select({ app: testerApplications, name: users.displayName, email: users.email })
    .from(testerApplications)
    .leftJoin(users, eq(users.id, testerApplications.userId))
    .where(eq(testerApplications.id, id))
    .limit(1);
  if (!r) return null;
  const [dups, connected] = await Promise.all([liveUsernames(db, [r.app.threadsUsername]), connectedUsernames(db, [r.app.threadsUsername])]);
  return toOperatorItem(r, dups, connected);
}

/**
 * 運営者の操作の共通の流れ：招待の管理がONか → 行ロック → 状態の確かめ → 変更 → 記録。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param id - tester_applications.id
 * @param fn - 行を受け取って変更する（記録の中身を返す）
 * @returns 変更後の1行
 */
async function operate(
  env: Env,
  operator: { id: string },
  id: string,
  fn: (tx: TxDb, row: Row) => Promise<{ action: "invite" | "decline" | "revert" | "removed"; detail?: Record<string, unknown> }>,
) {
  assertTesterInvitesEnabled(env);
  if (!isUuid(id)) throw new AppError("ITEM_NOT_FOUND", 404, "application not found");
  await withTransaction(env.DATABASE_URL, async (tx) => {
    const [row] = await tx.select().from(testerApplications).where(eq(testerApplications.id, id)).for("update").limit(1);
    if (!row) throw new AppError("ITEM_NOT_FOUND", 404, "application not found");
    const { action, detail } = await fn(tx, row);
    const stillThere = action !== "removed" || row.userId !== null;
    await recordOperatorEvent(tx, {
      actorUserId: operator.id,
      subjectUserId: row.userId,
      applicationId: stillThere ? row.id : null,
      action,
      detail,
    });
  });
  return operatorItem(createDb(env.DATABASE_URL), id);
}

/**
 * 「招待した」（申し込み中 → 招待済み、枠を使う。FR-009・FR-010）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param id - tester_applications.id
 * @param opts - force：枠がいっぱいでも進める
 * @returns 変更後の1行
 * @throws AppError TESTER_SLOTS_FULL・TESTER_APPLICATION_NOT_PENDING
 */
export async function invite(env: Env, operator: { id: string }, id: string, opts: { force?: boolean } = {}) {
  return operate(env, operator, id, async (tx, row) => {
    if (row.status !== "pending") throw notPending();
    // 枠の数を数えるあいだに、ほかの「招待した」が割り込まないようにする
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tester_slots'))`);
    const [settings, used] = await Promise.all([readOperatorSettings(tx), slotUsage(tx)]);
    if (!opts.force && used >= settings.testerSlotCapacity) {
      throw new AppError("TESTER_SLOTS_FULL", 409, "tester slots full", undefined, [String(used), String(settings.testerSlotCapacity)]);
    }
    await setStatus(tx, row.id, { status: "invited", holdsSlot: true });
    return { action: "invite", detail: opts.force ? { force: true } : undefined };
  });
}

/**
 * 「見送る」（申し込み中 → 見送り。FR-009）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param id - tester_applications.id
 * @param reason - 理由（任意、200文字まで）
 * @returns 変更後の1行
 */
export async function decline(env: Env, operator: { id: string }, id: string, reason: string | undefined) {
  return operate(env, operator, id, async (tx, row) => {
    if (row.status !== "pending") throw notPending();
    await setStatus(tx, row.id, { status: "declined", declineReason: reason?.trim() ? reason.trim() : null });
    return { action: "decline", detail: { withReason: Boolean(reason?.trim()) } };
  });
}

/**
 * 「申し込み中に戻す」（招待済み → 申し込み中、枠を使わない。FR-009）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param id - tester_applications.id
 * @returns 変更後の1行
 */
export async function revert(env: Env, operator: { id: string }, id: string) {
  return operate(env, operator, id, async (tx, row) => {
    if (row.status !== "invited") throw notPending();
    await setStatus(tx, row.id, { status: "pending", holdsSlot: false });
    return { action: "revert" };
  });
}

/**
 * 「外した」（外してよい → 枠を使わない。退会した人の行は消す。FR-011、research.md R15）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param id - tester_applications.id
 * @returns 変更後の1行（消したら null）
 */
export async function markRemoved(env: Env, operator: { id: string }, id: string) {
  return operate(env, operator, id, async (tx, row) => {
    if (!row.holdsSlot || row.removalReason === null) throw notPending();
    if (row.userId === null) {
      await tx.delete(testerApplications).where(eq(testerApplications.id, row.id));
    } else {
      await setStatus(tx, row.id, { holdsSlot: false });
    }
    return { action: "removed", detail: { reason: row.removalReason } };
  });
}

/**
 * テスター枠の数を変える（FR-010）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param capacity - 枠の数（1〜10000）
 * @returns 枠の使用数と数
 */
export async function setSlotCapacity(env: Env, operator: { id: string }, capacity: number) {
  // ほかの運営者の操作と同じく、招待の管理がOFFなら 404（FR-027。PR #71 のセルフレビュー）
  assertTesterInvitesEnabled(env);
  return withTransaction(env.DATABASE_URL, async (tx) => {
    const before = await readOperatorSettings(tx);
    await tx.update(operatorSettings).set({ testerSlotCapacity: capacity, updatedAt: new Date() }).where(eq(operatorSettings.id, 1));
    await recordOperatorEvent(tx, {
      actorUserId: operator.id,
      action: "slot_capacity",
      detail: { before: before.testerSlotCapacity, after: capacity },
    });
    return { used: await slotUsage(tx), capacity };
  });
}

