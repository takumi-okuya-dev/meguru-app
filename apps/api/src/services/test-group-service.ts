// テスト用のグループ（specs/016-test-groups research.md R2・R3・R6〜R8）。
// test_groups・test_group_members・test_group_events は、このファイルの外から書かない
// （料金なしの印を手で付けたときの granted_billing_exempt だけは billing-service.ts が外す。R7）。
import {
  TEST_GROUP_EVENTS_LIMIT,
  type TestGroupDetail,
  type TestGroupEventAction,
  type TestGroupSummary,
  type TestInvitePreview,
} from "@threads-grower/shared";
import { and, asc, count, desc, eq, getTableName, inArray, isNull, sql, type AnyColumn, type SQL, type Table } from "drizzle-orm";
import type { Env } from "../env";
import type { BillingMode } from "../lib/config";
import { createDb, withTransaction, type Db, type TxDb } from "../db/client";
import { testGroupEvents, testGroupMembers, testGroups, users } from "../db/schema";
import { AppError } from "../lib/errors";
import { sha256Hex } from "../lib/identifier-hash";
import { personName } from "./access";
import { inviteUrl, newInviteToken, openInviteToken, sealInviteToken } from "./invite-service";

/** users の表か、その別名（alias(users, …)）。 */
type UsersLike = Table & { id: AnyColumn; signedUpOpen: AnyColumn; clerkUserId: AnyColumn };

/**
 * 「テスト版に入れる人」のSQLの条件（data-model.md「判定」、research.md R2）。
 * OFFの間に登録した人・前からいた人（signed_up_open）か、閉じていないグループに入っている人か、運営者。
 * 判定はここだけに書き、ほかに写さない（Constitution原則V）。
 * 列は表の名前（別名なら別名）を付けて書く。1つの表だけの SELECT では drizzle が列を表の名前なしで書くため、
 * 副問い合わせの中で test_groups.id と取り違えないようにする。
 * @param u - users の表か別名
 * @param operators - 運営者のClerkのユーザーID（BillingMode.operators）
 * @returns 真偽のSQL
 */
export function testAccessSql(u: UsersLike = users, operators: readonly string[] = []): SQL<boolean> {
  const t = sql.identifier(getTableName(u));
  return sql<boolean>`(${t}."signed_up_open"${operatorOrSql(t, operators)} OR EXISTS (
    SELECT 1 FROM test_group_members tgm
    JOIN test_groups tg ON tg.id = tgm.group_id
    WHERE tgm.user_id = ${t}."id" AND tg.closed_at IS NULL
  ))`;
}

/**
 * 「料金なし」のSQLの条件（料金なしの印か、テスト用のグループがONの環境の運営者）。
 * 運営者は、テスト版でテストユーザーと同じく料金なしで使う（無料体験の表示を出さない）。本番（OFF）では印だけ。
 * 使える状態の判定（entitlementFromFacts の billingExempt・fullAccessSql）に渡す値は、すべてここから読む。
 * @param u - users の表か別名
 * @param mode - 決済のモード（testGroups と operators を見る）
 * @returns 真偽のSQL
 */
export function billingExemptSql(u: UsersLike, mode: BillingMode): SQL<boolean> {
  const t = sql.identifier(getTableName(u));
  return sql<boolean>`(${t}."billing_exempt"${mode.testGroups ? operatorOrSql(t, mode.operators ?? []) : sql``})`;
}

/**
 * 「または運営者」のSQLの断片（運営者がいなければ空）。
 * @param t - 表の名前（sql.identifier）
 * @param operators - 運営者のClerkのユーザーID
 * @returns SQLの断片
 */
function operatorOrSql(t: ReturnType<typeof sql.identifier>, operators: readonly string[]): SQL {
  if (operators.length === 0) return sql``;
  return sql` OR ${t}."clerk_user_id" IN (${sql.join(
    operators.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

// ---- 招待の文字列（research.md R8。チームの招待と同じ作りを使う。チームは「t_」、グループは「g_」） ----

const TOKEN_FORM = /^g_[A-Za-z0-9_-]{43}$/;

/**
 * 新しい招待の文字列を作り、保存する形（照合用のハッシュと暗号化した写し）にする。暗号の AAD にはグループのIDを使う。
 * @param env - Workers のバインディング
 * @param groupId - test_groups.id
 * @returns 保存する値
 */
async function sealNewToken(env: Env, groupId: string) {
  const sealed = await sealInviteToken(env, newInviteToken("g_"), groupId);
  return {
    inviteTokenHash: sealed.hash,
    inviteTokenCiphertext: sealed.ciphertext,
    inviteTokenIv: sealed.iv,
    inviteKeyVersion: sealed.keyVersion,
  };
}

/**
 * グループの招待のURL（WEB_ORIGIN/test-invite/{token}）を、暗号化した写しから作る。
 * @param env - Workers のバインディング
 * @param g - グループの行
 * @returns URL
 */
async function testInviteUrlOf(env: Env, g: typeof testGroups.$inferSelect): Promise<string> {
  const token = await openInviteToken(
    env,
    { ciphertext: g.inviteTokenCiphertext, iv: g.inviteTokenIv, keyVersion: g.inviteKeyVersion },
    g.id,
  );
  return inviteUrl(env, token, "test-invite");
}

/**
 * 使えない招待リンクのエラー（見つからない・作り直された・閉じた・仕組みがOFF）。
 * @returns 404 TEST_INVITE_INVALID
 */
export const testInviteInvalid = () => new AppError("TEST_INVITE_INVALID", 404, "test invite invalid");

/**
 * 招待の文字列からグループを探す（閉じたグループは見つからないものとする）。
 * @param db - データベース
 * @param token - 招待の文字列
 * @returns グループの行
 * @throws AppError TEST_INVITE_INVALID
 */
async function groupByToken(db: Db | TxDb, token: string) {
  if (!TOKEN_FORM.test(token)) throw testInviteInvalid();
  const [g] = await db
    .select()
    .from(testGroups)
    .where(and(eq(testGroups.inviteTokenHash, await sha256Hex(token)), isNull(testGroups.closedAt)))
    .limit(1);
  if (!g) throw testInviteInvalid();
  return g;
}

/**
 * グループの人数。
 * @param db - データベース
 * @param groupId - test_groups.id
 * @returns 人数
 */
async function memberCountOf(db: Db | TxDb, groupId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(testGroupMembers).where(eq(testGroupMembers.groupId, groupId));
  return Number(row?.n ?? 0);
}

/**
 * その人が今入っているグループ（閉じていないもの）。
 * @param db - データベース
 * @param userId - users.id
 * @returns グループのIDと名前。入っていなければ null
 */
async function currentGroupOf(db: Db | TxDb, userId: string) {
  const [row] = await db
    .select({ id: testGroups.id, name: testGroups.name })
    .from(testGroupMembers)
    .innerJoin(testGroups, eq(testGroups.id, testGroupMembers.groupId))
    .where(and(eq(testGroupMembers.userId, userId), isNull(testGroups.closedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * 記録の名前（表示名かメールアドレス）を読む。
 * @param db - データベース
 * @param userId - users.id
 * @returns 名前（利用者がいなければ空文字）
 */
async function nameOf(db: Db | TxDb, userId: string): Promise<string> {
  const [u] = await db.select({ displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, userId));
  return u ? personName(u) : "";
}

/**
 * グループの出来事を残す（FR-013、research.md R6）。
 * @param tx - トランザクション
 * @param e - グループ・何をしたか・した人・された人の名前・変える前後の値
 */
async function recordEvent(
  tx: TxDb,
  e: {
    groupId: string;
    action: TestGroupEventAction;
    actorUserId: string;
    /** した人の名前（読んであれば渡す。なければここで読む） */
    actorName?: string;
    subjectName?: string | null;
    details?: unknown;
  },
) {
  await tx.insert(testGroupEvents).values({
    groupId: e.groupId,
    action: e.action,
    actorUserId: e.actorUserId,
    actorName: e.actorName ?? (await nameOf(tx, e.actorUserId)),
    subjectName: e.subjectName ?? null,
    details: e.details ?? null,
  });
}

// ---- 招待の確認と参加（US1。contracts/api.md「招待の確認と参加」） ----

/**
 * 招待の確認。ログインしていなければ viewer は null。
 * @param env - Workers のバインディング
 * @param token - 招待の文字列
 * @param viewer - ログインした人（していなければ null）
 * @returns 確認の内容
 * @throws AppError TEST_INVITE_INVALID
 */
export async function previewTestInvite(env: Env, token: string, viewer: { id: string } | null): Promise<TestInvitePreview> {
  const db = createDb(env.DATABASE_URL);
  const g = await groupByToken(db, token);
  const full = (await memberCountOf(db, g.id)) >= g.capacity;
  if (!viewer) return { group: { name: g.name }, full, viewer: null };
  const current = await currentGroupOf(db, viewer.id);
  if (current) return { group: { name: g.name }, full, viewer: { state: "already_member", groupName: current.name } };
  return { group: { name: g.name }, full, viewer: { state: full ? "full" : "can_join" } };
}

/**
 * 「参加する」（FR-004・FR-005・FR-008、research.md R3・R7）。グループの行に鍵をかけてから数え、上限を超えない。
 * 入ったら料金なしの印を付ける（もともと付いていれば触らない）。
 * @param env - Workers のバインディング
 * @param user - ログインした人
 * @param token - 招待の文字列
 * @returns 入ったグループのID
 * @throws AppError TEST_INVITE_INVALID・TEST_GROUP_ALREADY_MEMBER・TEST_GROUP_FULL
 */
export async function joinTestGroup(env: Env, user: { id: string }, token: string): Promise<{ groupId: string }> {
  if (!TOKEN_FORM.test(token)) throw testInviteInvalid();
  const hash = await sha256Hex(token);
  return withTransaction(env.DATABASE_URL, async (tx) => {
    // 作り直し・閉じると同じくグループの行に鍵をかけ、かけた後にもう一度確かめる
    const [g] = await tx
      .select()
      .from(testGroups)
      .where(and(eq(testGroups.inviteTokenHash, hash), isNull(testGroups.closedAt)))
      .for("update");
    if (!g) throw testInviteInvalid();
    // 利用者の行にも鍵をかけてから「どこかに入っているか」を見る。同じ人が2つのグループの「参加する」を
    // 同時に押しても、後の方は先の参加が終わってから確かめるので、1人1グループのまま
    // （鍵の順は、閉じる・外すと同じく「グループ → 利用者」）
    const [u] = await tx.select({ exempt: users.billingExempt }).from(users).where(eq(users.id, user.id)).for("update");
    const current = await currentGroupOf(tx, user.id);
    if (current) throw new AppError("TEST_GROUP_ALREADY_MEMBER", 409, "already in a test group", undefined, [current.name]);
    if ((await memberCountOf(tx, g.id)) >= g.capacity) throw new AppError("TEST_GROUP_FULL", 409, "test group full");
    // 料金なしの印（research.md R7）。もともと付いていれば、グループで付けたことにしない
    const granted = u ? !u.exempt : false;
    await tx.insert(testGroupMembers).values({ userId: user.id, groupId: g.id, grantedBillingExempt: granted });
    if (granted) await tx.update(users).set({ billingExempt: true, updatedAt: new Date() }).where(eq(users.id, user.id));
    const name = await nameOf(tx, user.id);
    await recordEvent(tx, { groupId: g.id, action: "member_joined", actorUserId: user.id, actorName: name, subjectName: name });
    return { groupId: g.id };
  });
}

// ---- 運営者の操作（US2。contracts/api.md「運営者のAPI」） ----

/**
 * グループを出る人の後始末：行を消し、グループで付けた料金なしの印を戻す（research.md R7）。
 * @param tx - トランザクション
 * @param rows - 出る人（user_id と granted_billing_exempt）
 */
async function releaseMembers(tx: TxDb, rows: { userId: string; grantedBillingExempt: boolean }[]) {
  if (rows.length === 0) return;
  await tx.delete(testGroupMembers).where(inArray(testGroupMembers.userId, rows.map((r) => r.userId)));
  const revert = rows.filter((r) => r.grantedBillingExempt).map((r) => r.userId);
  if (revert.length > 0) await tx.update(users).set({ billingExempt: false, updatedAt: new Date() }).where(inArray(users.id, revert));
}

/**
 * グループの行を運営者の画面の形にする。
 * @param env - Workers のバインディング
 * @param g - グループの行
 * @param memberCount - 人数
 * @returns 一覧の行
 */
async function toSummary(env: Env, g: typeof testGroups.$inferSelect, memberCount: number): Promise<TestGroupSummary> {
  return {
    id: g.id,
    name: g.name,
    capacity: g.capacity,
    memberCount,
    inviteUrl: g.closedAt ? null : await testInviteUrlOf(env, g),
    closedAt: g.closedAt?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
  };
}

/**
 * グループの一覧（新しい順。閉じたものは後ろ）。
 * @param env - Workers のバインディング
 * @returns 一覧
 */
export async function listTestGroups(env: Env): Promise<TestGroupSummary[]> {
  const db = createDb(env.DATABASE_URL);
  const rows = await db
    // 1つの表だけの SELECT では drizzle が列を表の名前なしで書くので、外の表の名前を付けて書く（testAccessSql と同じ）
    .select({ g: testGroups, n: sql<number>`(SELECT count(*) FROM test_group_members m WHERE m.group_id = "test_groups"."id")::int` })
    .from(testGroups)
    .orderBy(sql`${testGroups.closedAt} IS NOT NULL`, desc(testGroups.createdAt));
  return Promise.all(rows.map((r) => toSummary(env, r.g, Number(r.n))));
}

/**
 * グループの詳しい内容（人・記録）。
 * @param env - Workers のバインディング
 * @param groupId - test_groups.id
 * @returns 詳しい内容
 * @throws AppError ITEM_NOT_FOUND
 */
export async function testGroupDetail(env: Env, groupId: string): Promise<TestGroupDetail> {
  const db = createDb(env.DATABASE_URL);
  const g = await findGroup(db, groupId);
  const [members, events] = await Promise.all([
    db
      .select({ userId: users.id, displayName: users.displayName, email: users.email, joinedAt: testGroupMembers.joinedAt })
      .from(testGroupMembers)
      .innerJoin(users, eq(users.id, testGroupMembers.userId))
      .where(eq(testGroupMembers.groupId, g.id))
      .orderBy(asc(testGroupMembers.joinedAt)),
    db
      .select()
      .from(testGroupEvents)
      .where(eq(testGroupEvents.groupId, g.id))
      .orderBy(desc(testGroupEvents.createdAt))
      .limit(TEST_GROUP_EVENTS_LIMIT),
  ]);
  return {
    ...(await toSummary(env, g, members.length)),
    members: members.map((m) => ({ userId: m.userId, name: personName(m), email: m.email, joinedAt: m.joinedAt.toISOString() })),
    events: events.map((e) => ({
      action: e.action as TestGroupEventAction,
      actorName: e.actorName,
      subjectName: e.subjectName,
      details: e.details,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * グループを探す（運営者の操作）。
 * @param db - データベース
 * @param groupId - test_groups.id
 * @param lock - 行に鍵をかけるか（トランザクションの中で）
 * @returns グループの行
 * @throws AppError ITEM_NOT_FOUND
 */
async function findGroup(db: Db | TxDb, groupId: string, lock = false) {
  if (!UUID.test(groupId)) throw groupNotFound();
  const q = db.select().from(testGroups).where(eq(testGroups.id, groupId));
  const [g] = lock ? await q.for("update") : await q;
  if (!g) throw groupNotFound();
  return g;
}

/**
 * 運営者の操作で、グループが見つからないエラー。
 * @returns 404 ITEM_NOT_FOUND
 */
const groupNotFound = () => new AppError("ITEM_NOT_FOUND", 404, "test group not found");

/**
 * 閉じたグループを変えようとしたエラー。
 * @returns 409 TEST_GROUP_CLOSED
 */
const groupClosed = () => new AppError("TEST_GROUP_CLOSED", 409, "test group closed");

/**
 * グループを作る（FR-001・FR-002）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param input - 名前と上限（スキーマで確かめた値）
 * @returns 作ったグループ
 */
export async function createTestGroup(env: Env, operator: { id: string }, input: { name: string; capacity: number }) {
  const id = crypto.randomUUID();
  const sealed = await sealNewToken(env, id);
  const g = await withTransaction(env.DATABASE_URL, async (tx) => {
    const [row] = await tx
      .insert(testGroups)
      .values({ id, name: input.name, capacity: input.capacity, createdByUserId: operator.id, ...sealed })
      .returning();
    await recordEvent(tx, { groupId: id, action: "created", actorUserId: operator.id, details: { name: input.name, capacity: input.capacity } });
    return row!;
  });
  return toSummary(env, g, 0);
}

/**
 * 名前・上限を変える（FR-010）。上限を今の人数より少なくしても、入っている人は外さない。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param groupId - test_groups.id
 * @param input - 変える値
 * @returns 変えた後の詳しい内容
 * @throws AppError ITEM_NOT_FOUND・TEST_GROUP_CLOSED
 */
export async function updateTestGroup(env: Env, operator: { id: string }, groupId: string, input: { name?: string; capacity?: number }) {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    const g = await findGroup(tx, groupId, true);
    if (g.closedAt) throw groupClosed();
    const name = input.name ?? g.name;
    const capacity = input.capacity ?? g.capacity;
    await tx.update(testGroups).set({ name, capacity, updatedAt: new Date() }).where(eq(testGroups.id, g.id));
    if (name !== g.name) {
      await recordEvent(tx, { groupId: g.id, action: "renamed", actorUserId: operator.id, details: { from: g.name, to: name } });
    }
    if (capacity !== g.capacity) {
      await recordEvent(tx, { groupId: g.id, action: "capacity_changed", actorUserId: operator.id, details: { from: g.capacity, to: capacity } });
    }
  });
  return testGroupDetail(env, groupId);
}

/**
 * 招待リンクを作り直す（FR-002）。前の文字列は使えなくなる。入っている人はそのまま。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param groupId - test_groups.id
 * @returns 作り直した後の詳しい内容
 * @throws AppError ITEM_NOT_FOUND・TEST_GROUP_CLOSED
 */
export async function rotateTestGroupInvite(env: Env, operator: { id: string }, groupId: string) {
  const sealed = await sealNewToken(env, groupId);
  await withTransaction(env.DATABASE_URL, async (tx) => {
    const g = await findGroup(tx, groupId, true);
    if (g.closedAt) throw groupClosed();
    const now = new Date();
    await tx.update(testGroups).set({ ...sealed, inviteRotatedAt: now, updatedAt: now }).where(eq(testGroups.id, g.id));
    await recordEvent(tx, { groupId: g.id, action: "invite_rotated", actorUserId: operator.id });
  });
  return testGroupDetail(env, groupId);
}

/**
 * 人を外す（FR-010）。その人はテスト版に入れない人になり、グループで付けた料金なしの印が外れる。データは消さない。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param groupId - test_groups.id
 * @param userId - 外す人
 * @returns 外した後の詳しい内容
 * @throws AppError ITEM_NOT_FOUND（グループか人が見つからない）
 */
export async function removeTestGroupMember(env: Env, operator: { id: string }, groupId: string, userId: string) {
  if (!UUID.test(userId)) throw groupNotFound();
  await withTransaction(env.DATABASE_URL, async (tx) => {
    const g = await findGroup(tx, groupId, true);
    const [m] = await tx
      .select({ userId: testGroupMembers.userId, grantedBillingExempt: testGroupMembers.grantedBillingExempt })
      .from(testGroupMembers)
      .where(and(eq(testGroupMembers.groupId, g.id), eq(testGroupMembers.userId, userId)));
    if (!m) throw groupNotFound();
    const subjectName = await nameOf(tx, userId);
    await releaseMembers(tx, [m]);
    await recordEvent(tx, { groupId: g.id, action: "member_removed", actorUserId: operator.id, subjectName });
  });
  return testGroupDetail(env, groupId);
}

/**
 * グループを閉じる（FR-010）。入っている人を全員外し、招待リンクを使えなくする。閉じたグループは開き直さない。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param groupId - test_groups.id
 * @returns 閉じた後の詳しい内容
 * @throws AppError ITEM_NOT_FOUND・TEST_GROUP_CLOSED
 */
export async function closeTestGroup(env: Env, operator: { id: string }, groupId: string) {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    const g = await findGroup(tx, groupId, true);
    if (g.closedAt) throw groupClosed();
    const rows = await tx
      .select({ userId: testGroupMembers.userId, grantedBillingExempt: testGroupMembers.grantedBillingExempt })
      .from(testGroupMembers)
      .where(eq(testGroupMembers.groupId, g.id));
    await releaseMembers(tx, rows);
    const now = new Date();
    await tx.update(testGroups).set({ closedAt: now, updatedAt: now }).where(eq(testGroups.id, g.id));
    await recordEvent(tx, { groupId: g.id, action: "closed", actorUserId: operator.id, details: { removed: rows.length } });
  });
  return testGroupDetail(env, groupId);
}
