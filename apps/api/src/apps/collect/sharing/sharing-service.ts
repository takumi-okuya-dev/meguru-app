// 経費・運営メンバー・分配（specs/collect/003-revenue-sharing contracts/api.md 1-1〜1-3、FR-001〜FR-016、research.md R1〜R5）。
// 分配は毎回計算する（持たない）。経費・運営メンバーを変えても、イベントの版は上げない（受付の画面に関係しない。data-model.md 4）。
// 運営メンバーを変えるときはイベントの行をロックし、変えたあとの全員で人数の上限と傾斜の上限を確かめる（崩れたらトランザクションごと戻す）。
import {
  computeDistribution,
  maxRatioTenths,
  RATIO_TENTHS,
  ratiosWithinLimit,
  SHARING_LIMITS,
  type CreateExpenseRequest,
  type CreateSharingMemberRequest,
  type Expense,
  type SharingMember,
  type SharingRole,
  type SharingSnapshot,
  type UpdateExpenseRequest,
  type UpdateSharingMemberRequest,
} from "@meguru/shared";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { loadOwnedEvent, type CollectEventRow } from "../access";
import { tally } from "../closing/tally";
import { collectExpenses, collectReceptionRecords, collectRosterPeople, collectSharingInvites, collectSharingMembers } from "../schema";
import { revenueOf } from "./money";

/** 運営メンバーの行。 */
export type MemberRow = typeof collectSharingMembers.$inferSelect;
type ExpenseRow = typeof collectExpenses.$inferSelect;

/** 主催者の行の、はじめの名前（主催者があとで直せる）。 */
export const OWNER_MEMBER_NAME = "主催者";

/**
 * ない・ほかのイベントの運営メンバーや経費。
 * @returns 404 ITEM_NOT_FOUND のエラー
 */
const notFound = () => new AppError("ITEM_NOT_FOUND", 404, "item not found");

/**
 * イベントの運営メンバー（並びの順）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param eventId - イベントの番号
 * @returns 行
 */
export async function loadMembers(db: Db | TxDb, eventId: string): Promise<MemberRow[]> {
  return db.select().from(collectSharingMembers).where(eq(collectSharingMembers.eventId, eventId)).orderBy(asc(collectSharingMembers.position), asc(collectSharingMembers.createdAt));
}

/**
 * 運営メンバーが1人もいなければ、主催者の行を作る（003 の前に作ったイベント・はじめて開いたとき。research R5）。
 * 同時に開いても主催者の行は1つ（部分一意索引で重なりを捨てる）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param event - イベント
 * @param now - 今
 */
export async function ensureOwnerMember(db: Db | TxDb, event: CollectEventRow, now: Date): Promise<void> {
  const [any] = await db.select({ id: collectSharingMembers.id }).from(collectSharingMembers).where(eq(collectSharingMembers.eventId, event.id)).limit(1);
  if (any) return;
  await db
    .insert(collectSharingMembers)
    .values({
      eventId: event.id,
      name: OWNER_MEMBER_NAME,
      role: "leader",
      ratioTenths: RATIO_TENTHS.default,
      position: 1,
      isOwner: true,
      userId: event.ownerUserId,
      linkedAt: now,
    })
    .onConflictDoNothing();
}

/**
 * 分配の画面の数字を作る（主催者とつながった運営メンバーで同じもの。research R3）。
 * @param db - データベース
 * @param event - イベント
 * @param now - 今（招待の期限を見る）
 * @returns 分配の画面の数字
 */
export async function buildSharingSnapshot(db: Db, event: CollectEventRow, now: Date): Promise<SharingSnapshot> {
  const [people, records, members, expenses] = await Promise.all([
    db.select({ id: collectRosterPeople.id, media: collectRosterPeople.media }).from(collectRosterPeople).where(eq(collectRosterPeople.eventId, event.id)),
    db
      .select({
        rosterPersonId: collectReceptionRecords.rosterPersonId,
        method: collectReceptionRecords.method,
        amount: collectReceptionRecords.amount,
        paymentStatus: collectReceptionRecords.paymentStatus,
      })
      .from(collectReceptionRecords)
      .where(eq(collectReceptionRecords.eventId, event.id)),
    loadMembers(db, event.id),
    db.select().from(collectExpenses).where(eq(collectExpenses.eventId, event.id)).orderBy(asc(collectExpenses.createdAt)),
  ]);
  const invites =
    members.length === 0
      ? []
      : await db
          .select({ memberId: collectSharingInvites.memberId, expiresAt: collectSharingInvites.expiresAt })
          .from(collectSharingInvites)
          .where(and(inArray(collectSharingInvites.memberId, members.map((m) => m.id)), gt(collectSharingInvites.expiresAt, now)));
  const revenue = revenueOf(tally(people, records));
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const inviteOf = new Map(invites.map((i) => [i.memberId, i.expiresAt.toISOString()]));
  const calc = members.map((m) => ({ id: m.id, role: m.role as SharingRole, ratioTenths: m.ratioTenths, isOwner: m.isOwner }));
  return {
    event: { id: event.id, name: event.name, startsAt: event.startsAt.toISOString() },
    revenue,
    expenses: expenses.map((e) => toExpense(e, memberName)),
    expenseTotal,
    members: members.map(
      (m): SharingMember => ({
        id: m.id,
        name: m.name,
        role: m.role as SharingRole,
        ratioTenths: m.ratioTenths,
        isOwner: m.isOwner,
        linked: m.userId !== null,
        invite: inviteOf.has(m.id) ? { expiresAt: inviteOf.get(m.id)! } : null,
      }),
    ),
    maxRatioTenths: maxRatioTenths(calc),
    current: computeDistribution(revenue.paid - expenseTotal, calc),
    projected: computeDistribution(revenue.paid + revenue.awaiting - expenseTotal, calc),
    reimbursements: reimbursementsOf(expenses, members),
  };
}

/**
 * 経費の行を応答の形にする。
 * @param row - expenses の行
 * @param memberName - 運営メンバーの名前
 * @returns 経費
 */
function toExpense(row: ExpenseRow, memberName: Map<string, string>): Expense {
  const payer = row.payerMemberId
    ? { memberId: row.payerMemberId, name: memberName.get(row.payerMemberId) ?? "" }
    : row.payerName
      ? { memberId: null, name: row.payerName }
      : null;
  return { id: row.id, name: row.name, amount: row.amount, payer };
}

/**
 * 立て替えの戻し（FR-013）。運営メンバーは並びの順、運営メンバーでない人は名前ごとに、そのあと。
 * @param expenses - 経費
 * @param members - 運営メンバー
 * @returns 戻す額のある人
 */
function reimbursementsOf(expenses: readonly ExpenseRow[], members: readonly MemberRow[]): SharingSnapshot["reimbursements"] {
  const byMember = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const e of expenses) {
    if (e.payerMemberId) byMember.set(e.payerMemberId, (byMember.get(e.payerMemberId) ?? 0) + e.amount);
    else if (e.payerName) byName.set(e.payerName, (byName.get(e.payerName) ?? 0) + e.amount);
  }
  return [
    ...members.filter((m) => byMember.has(m.id)).map((m) => ({ memberId: m.id, name: m.name, amount: byMember.get(m.id)! })),
    ...[...byName].map(([name, amount]) => ({ memberId: null, name, amount })),
  ];
}

/**
 * 分配の画面（GET …/sharing）。運営メンバーがいなければ主催者の行を作る。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param now - 今
 * @returns 分配の画面の数字
 */
export async function sharingSnapshot(db: Db, ownerUserId: string, eventId: string, now: Date): Promise<SharingSnapshot> {
  const event = await loadOwnedEvent(db, ownerUserId, eventId);
  await ensureOwnerMember(db, event, now);
  return buildSharingSnapshot(db, event, now);
}

/**
 * 主催者のイベントをロックして中身を変え、変えたあとの分配の画面を返す。
 * @param databaseUrl - 接続文字列
 * @param db - 読み直しに使うデータベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param now - 今
 * @param change - 変える中身
 * @returns 分配の画面の数字
 */
async function mutate(
  databaseUrl: string,
  db: Db,
  ownerUserId: string,
  eventId: string,
  now: Date,
  change: (tx: TxDb, event: CollectEventRow) => Promise<void>,
): Promise<SharingSnapshot> {
  const event = await withTransaction(databaseUrl, async (tx) => {
    const ev = await loadOwnedEvent(tx, ownerUserId, eventId, { forUpdate: true });
    await ensureOwnerMember(tx, ev, now);
    await change(tx, ev);
    return ev;
  });
  return buildSharingSnapshot(db, event, now);
}

/**
 * 立て替えた運営メンバーが、このイベントの人かを確かめる。
 * @param tx - トランザクション
 * @param eventId - イベントの番号
 * @param memberId - 運営メンバーの番号
 * @throws AppError ITEM_NOT_FOUND
 */
async function assertMemberOfEvent(tx: TxDb, eventId: string, memberId: string): Promise<void> {
  const [row] = await tx
    .select({ id: collectSharingMembers.id })
    .from(collectSharingMembers)
    .where(and(eq(collectSharingMembers.id, memberId), eq(collectSharingMembers.eventId, eventId)))
    .limit(1);
  if (!row) throw notFound();
}

/**
 * 経費を足す（POST …/expenses。FR-001）。1イベント100件まで。
 * @param databaseUrl - 接続文字列
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param input - 検証済みの入力
 * @param now - 今
 * @returns 分配の画面の数字
 * @throws AppError ITEM_LIMIT_REACHED・ITEM_NOT_FOUND（ほかのイベントの運営メンバー）
 */
export async function addExpense(databaseUrl: string, db: Db, ownerUserId: string, eventId: string, input: CreateExpenseRequest, now: Date): Promise<SharingSnapshot> {
  return mutate(databaseUrl, db, ownerUserId, eventId, now, async (tx, event) => {
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(collectExpenses).where(eq(collectExpenses.eventId, event.id))) as [{ n: number }];
    if (n >= SHARING_LIMITS.expensesPerEvent) throw new AppError("ITEM_LIMIT_REACHED", 409, "expense limit reached");
    if (input.payerMemberId) await assertMemberOfEvent(tx, event.id, input.payerMemberId);
    await tx.insert(collectExpenses).values({
      eventId: event.id,
      name: input.name,
      amount: input.amount,
      payerMemberId: input.payerMemberId ?? null,
      payerName: input.payerMemberId ? null : (input.payerName ?? null),
    });
  });
}

/**
 * 経費を直す（PATCH …/expenses/:expenseId）。立て替えた人は payerMemberId か payerName を送ったときだけ変える。
 * @param databaseUrl - 接続文字列
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param expenseId - 経費の番号
 * @param input - 検証済みの入力
 * @param now - 今
 * @returns 分配の画面の数字
 * @throws AppError ITEM_NOT_FOUND
 */
export async function updateExpense(
  databaseUrl: string,
  db: Db,
  ownerUserId: string,
  eventId: string,
  expenseId: string,
  input: UpdateExpenseRequest,
  now: Date,
): Promise<SharingSnapshot> {
  if (!isUuid(expenseId)) throw notFound();
  return mutate(databaseUrl, db, ownerUserId, eventId, now, async (tx, event) => {
    const payerChanged = input.payerMemberId !== undefined || input.payerName !== undefined;
    if (input.payerMemberId) await assertMemberOfEvent(tx, event.id, input.payerMemberId);
    const rows = await tx
      .update(collectExpenses)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(payerChanged ? { payerMemberId: input.payerMemberId ?? null, payerName: input.payerMemberId ? null : (input.payerName ?? null) } : {}),
      })
      .where(and(eq(collectExpenses.id, expenseId), eq(collectExpenses.eventId, event.id)))
      .returning({ id: collectExpenses.id });
    if (rows.length === 0) throw notFound();
  });
}

/**
 * 経費を消す（DELETE …/expenses/:expenseId）。
 * @param databaseUrl - 接続文字列
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param expenseId - 経費の番号
 * @param now - 今
 * @returns 分配の画面の数字
 * @throws AppError ITEM_NOT_FOUND
 */
export async function deleteExpense(databaseUrl: string, db: Db, ownerUserId: string, eventId: string, expenseId: string, now: Date): Promise<SharingSnapshot> {
  if (!isUuid(expenseId)) throw notFound();
  return mutate(databaseUrl, db, ownerUserId, eventId, now, async (tx, event) => {
    const rows = await tx
      .delete(collectExpenses)
      .where(and(eq(collectExpenses.id, expenseId), eq(collectExpenses.eventId, event.id)))
      .returning({ id: collectExpenses.id });
    if (rows.length === 0) throw notFound();
  });
}

/**
 * 変えたあとの運営メンバーで、人数の上限と傾斜の上限を確かめる（research R2）。
 * @param tx - トランザクション
 * @param eventId - イベントの番号
 * @throws AppError ITEM_LIMIT_REACHED・RATIO_TOO_HIGH
 */
async function assertMembersValid(tx: TxDb, eventId: string): Promise<void> {
  const members = await loadMembers(tx, eventId);
  if (members.length > SHARING_LIMITS.membersPerEvent) throw new AppError("ITEM_LIMIT_REACHED", 409, "member limit reached");
  if (!ratiosWithinLimit(members.map((m) => ({ role: m.role as SharingRole, ratioTenths: m.ratioTenths })))) {
    throw new AppError("RATIO_TOO_HIGH", 400, "leader ratios too high", undefined, ["ratioTenths"]);
  }
}

/**
 * 役割と傾斜の組（リーダーで傾斜がなければ既定、メンバーは傾斜なし）。
 * @param role - 役割
 * @param ratioTenths - 入れた傾斜
 * @param current - 今の傾斜（直すとき）
 * @returns 保存する傾斜
 */
function ratioFor(role: SharingRole, ratioTenths: number | null | undefined, current: number | null = null): number | null {
  if (role === "member") return null;
  return ratioTenths ?? current ?? RATIO_TENTHS.default;
}

/**
 * 運営メンバーを足す（POST …/members。FR-010・FR-011）。
 * @param databaseUrl - 接続文字列
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param input - 検証済みの入力
 * @param now - 今
 * @returns 分配の画面の数字
 * @throws AppError ITEM_LIMIT_REACHED・RATIO_TOO_HIGH
 */
export async function addMember(databaseUrl: string, db: Db, ownerUserId: string, eventId: string, input: CreateSharingMemberRequest, now: Date): Promise<SharingSnapshot> {
  return mutate(databaseUrl, db, ownerUserId, eventId, now, async (tx, event) => {
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${collectSharingMembers.position}), 0)::int + 1` })
      .from(collectSharingMembers)
      .where(eq(collectSharingMembers.eventId, event.id))) as [{ next: number }];
    await tx.insert(collectSharingMembers).values({ eventId: event.id, name: input.name, role: input.role, ratioTenths: ratioFor(input.role, input.ratioTenths), position: next });
    await assertMembersValid(tx, event.id);
  });
}

/**
 * 運営メンバーの行を読む（このイベントの人だけ）。
 * @param tx - トランザクション
 * @param eventId - イベントの番号
 * @param memberId - 運営メンバーの番号
 * @returns 行
 * @throws AppError ITEM_NOT_FOUND
 */
async function loadMember(tx: TxDb, eventId: string, memberId: string): Promise<MemberRow> {
  if (!isUuid(memberId)) throw notFound();
  const [row] = await tx
    .select()
    .from(collectSharingMembers)
    .where(and(eq(collectSharingMembers.id, memberId), eq(collectSharingMembers.eventId, eventId)))
    .limit(1);
  if (!row) throw notFound();
  return row;
}

/**
 * 運営メンバーを直す（PATCH …/members/:memberId）。
 * @param databaseUrl - 接続文字列
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param memberId - 運営メンバーの番号
 * @param input - 検証済みの入力
 * @param now - 今
 * @returns 分配の画面の数字
 * @throws AppError ITEM_NOT_FOUND・RATIO_TOO_HIGH
 */
export async function updateMember(
  databaseUrl: string,
  db: Db,
  ownerUserId: string,
  eventId: string,
  memberId: string,
  input: UpdateSharingMemberRequest,
  now: Date,
): Promise<SharingSnapshot> {
  return mutate(databaseUrl, db, ownerUserId, eventId, now, async (tx, event) => {
    const row = await loadMember(tx, event.id, memberId);
    const role = input.role ?? (row.role as SharingRole);
    await tx
      .update(collectSharingMembers)
      .set({ ...(input.name !== undefined ? { name: input.name } : {}), role, ratioTenths: ratioFor(role, input.ratioTenths, row.ratioTenths) })
      .where(eq(collectSharingMembers.id, row.id));
    await assertMembersValid(tx, event.id);
  });
}

/**
 * 運営メンバーを消す（DELETE …/members/:memberId）。立て替えた経費は、名前で立て替えた人として残す（戻す額を消さない）。
 * つながりと招待も一緒に消える。
 * @param databaseUrl - 接続文字列
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param memberId - 運営メンバーの番号
 * @param now - 今
 * @returns 分配の画面の数字
 * @throws AppError ITEM_NOT_FOUND・RATIO_TOO_HIGH（消すとメンバーの分がなくなる）
 */
export async function deleteMember(databaseUrl: string, db: Db, ownerUserId: string, eventId: string, memberId: string, now: Date): Promise<SharingSnapshot> {
  return mutate(databaseUrl, db, ownerUserId, eventId, now, async (tx, event) => {
    const row = await loadMember(tx, event.id, memberId);
    await tx.update(collectExpenses).set({ payerMemberId: null, payerName: row.name }).where(eq(collectExpenses.payerMemberId, row.id));
    await tx.delete(collectSharingMembers).where(eq(collectSharingMembers.id, row.id));
    await assertMembersValid(tx, event.id);
  });
}

/**
 * つながりを外す（DELETE …/members/:memberId/link。FR-055）。主催者の行は外せない。
 * @param databaseUrl - 接続文字列
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param memberId - 運営メンバーの番号
 * @param now - 今
 * @returns 分配の画面の数字
 * @throws AppError ITEM_NOT_FOUND・VALIDATION_FAILED（主催者の行）
 */
export async function unlinkMember(databaseUrl: string, db: Db, ownerUserId: string, eventId: string, memberId: string, now: Date): Promise<SharingSnapshot> {
  return mutate(databaseUrl, db, ownerUserId, eventId, now, async (tx, event) => {
    const row = await loadMember(tx, event.id, memberId);
    if (row.isOwner) throw new AppError("VALIDATION_FAILED", 400, "owner row cannot be unlinked", undefined, ["memberId"]);
    await tx.update(collectSharingMembers).set({ userId: null, linkedAt: null }).where(eq(collectSharingMembers.id, row.id));
  });
}
