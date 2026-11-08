// 招待の管理と上限の記録（specs/024-tester-invite-connect research.md R14・R15、data-model.md 1-3）。
// detail には Threads のユーザー名・名前・メールアドレスを入れない（退会したら、たどれなくなるようにする）。
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db, TxDb } from "../db/client";
import { operatorEvents, users } from "../db/schema";

/** 記録の種類。 */
export const OPERATOR_EVENT_ACTIONS = [
  "apply",
  "cancel",
  "invite",
  "decline",
  "revert",
  "removed",
  "slot_capacity",
  "default_limits",
  "user_limits",
] as const;
/** 記録の種類。 */
export type OperatorEventAction = (typeof OPERATOR_EVENT_ACTIONS)[number];

/**
 * 記録を1行足す。
 * @param db - データベース（トランザクションの中でもよい）
 * @param e - 操作した人・対象の人・申し込み・種類・中身（個人の情報を入れない）
 * @returns なし
 */
export async function recordOperatorEvent(
  db: Db | TxDb,
  e: {
    actorUserId: string | null;
    subjectUserId?: string | null;
    applicationId?: string | null;
    action: OperatorEventAction;
    detail?: Record<string, unknown> | null;
  },
): Promise<void> {
  await db.insert(operatorEvents).values({
    actorUserId: e.actorUserId,
    subjectUserId: e.subjectUserId ?? null,
    applicationId: e.applicationId ?? null,
    action: e.action,
    detail: e.detail ?? null,
  });
}

/**
 * ある人の、直近の申し込みと取り消しの回数（回数の制限に使う。FR-006）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @param since - この時刻から数える
 * @returns 回数
 */
export async function countRecentApplyActions(db: Db | TxDb, userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(operatorEvents)
    .where(
      and(
        eq(operatorEvents.actorUserId, userId),
        inArray(operatorEvents.action, ["apply", "cancel"]),
        gte(operatorEvents.createdAt, since),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * 記録を新しい順に読む（運営者の画面）。
 * @param db - データベース
 * @param opts - 読む種類と件数
 * @returns 記録（操作した人の名前を付ける。退会していれば null）
 */
export async function listOperatorEvents(db: Db, opts: { actions: readonly OperatorEventAction[]; limit: number }) {
  const rows = await db
    .select({
      at: operatorEvents.createdAt,
      action: operatorEvents.action,
      detail: operatorEvents.detail,
      actorName: users.displayName,
      actorEmail: users.email,
    })
    .from(operatorEvents)
    .leftJoin(users, eq(users.id, operatorEvents.actorUserId))
    .where(inArray(operatorEvents.action, [...opts.actions]))
    .orderBy(desc(operatorEvents.createdAt))
    .limit(opts.limit);
  return rows.map((r) => ({
    at: r.at.toISOString(),
    actor: r.actorName ?? r.actorEmail ?? null,
    action: r.action,
    detail: r.detail,
  }));
}
