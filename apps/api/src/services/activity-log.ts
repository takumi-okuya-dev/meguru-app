// 操作の記録（specs/008-team-operations research.md R9、contracts/api.md「操作の記録」）。
// チームに入っているAccountだけ（specs/011 research.md R8）、その操作と同じトランザクションで書く。
// 90日を過ぎたものは日次の処理で消す。
import {
  ACTIVITY_DETAILS_EXCERPT_LIMIT,
  ACTIVITY_LOG_RETENTION_DAYS,
  ACTIVITY_PAGE_MAX,
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_SUMMARY_CHARS,
} from "@threads-grower/shared";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../db/client";
import { activityLogs, users } from "../db/schema";
import { AppError } from "../lib/errors";
import { isUuid, personName, type AccountAccess, type ActorRole } from "./access";

/** 操作の記録の種類（画面の絞り込みの単位）。 */
export type ActivityKind = "review" | "draft" | "content" | "settings" | "member";

/** recordActivity に渡す内容。 */
export type ActivityInput = {
  kind: ActivityKind;
  action: string;
  /** まとめての操作の件数（既定1） */
  itemCount?: number;
  /** 対象の要約（投稿の本文なら書き出しにする） */
  summary?: string | null;
  /** まとめての操作の対象の本文（書き出しにして最大50件） */
  excerpts?: string[];
  /** そのほかの内容（却下の理由、変更の前後、人の名前など） */
  details?: Record<string, unknown>;
  /** チームに入っていなくても書く */
  force?: boolean;
};

/**
 * 本文の書き出し（最初の行を30文字まで）。
 * @param body - 本文
 * @returns 書き出し
 */
export function excerptOf(body: string): string {
  const line = body.trim().split("\n")[0] ?? "";
  const chars = [...line];
  return chars.length > ACTIVITY_SUMMARY_CHARS ? `${chars.slice(0, ACTIVITY_SUMMARY_CHARS).join("")}…` : line;
}

/**
 * 内容の保存と操作の記録を、同じトランザクションで行う（記録だけが失敗して、保存済みなのに500になることを防ぐ。
 * PR #9 のCodexレビュー）。記録を書かない（チームがない・access がない）ときは、トランザクションを開かずに
 * これまでどおり1回の書き込みで行う（個人運用の速さを変えない）。
 * @param connectionString - DATABASE_URL
 * @param db - トランザクションを開かないときに使うデータベース
 * @param access - 操作した人の判定の結果
 * @param fn - 保存と recordActivity を行う処理
 * @returns fn の戻り値
 */
export async function withActivityTx<T>(
  connectionString: string,
  db: Db,
  access: AccountAccess | undefined,
  fn: (q: Db | TxDb) => Promise<T>,
): Promise<T> {
  if (!access?.hasTeam) return fn(db);
  return withTransaction(connectionString, fn);
}

/**
 * 操作を記録する（FR-050・FR-050a）。チームに入っているAccountのときだけ書く（force なら必ず書く）。
 * した人の名前・役割は、その時点の値を写して持つ（後で外されても残る。FR-054）。
 * @param db - その操作と同じトランザクション
 * @param access - 操作した人の判定の結果
 * @param input - 記録する内容
 */
export async function recordActivity(db: Db | TxDb, access: AccountAccess, input: ActivityInput) {
  if (!access.hasTeam && !input.force) return;
  await insertActivity(db, {
    accountId: access.account.id,
    actor: access.actor,
    ...input,
  });
}

/**
 * 操作の記録を1行書く（チームの有無は呼び出し側が決める）。チームの操作（参加・ロール・担当・見せる設定など）で使う。
 * @param db - その操作と同じトランザクション
 * @param input - Account・した人（その時点の名前と役割）・記録する内容
 */
export async function insertActivity(
  db: Db | TxDb,
  input: ActivityInput & { accountId: string; actor: { id: string; name: string; role: ActorRole } },
) {
  const excerpts = input.excerpts?.slice(0, ACTIVITY_DETAILS_EXCERPT_LIMIT).map(excerptOf);
  const details = { ...(input.details ?? {}), ...(excerpts && excerpts.length > 0 ? { excerpts } : {}) };
  await db.insert(activityLogs).values({
    accountId: input.accountId,
    actorUserId: input.actor.id,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    kind: input.kind,
    action: input.action,
    itemCount: input.itemCount ?? 1,
    summary: input.summary ?? (excerpts?.[0] ?? null),
    details: Object.keys(details).length > 0 ? details : null,
  });
}

/**
 * 90日の境目。
 * @param now - 現在時刻
 * @returns これより前の記録は見せず、消す
 */
function retentionStart(now: Date): Date {
  return new Date(now.getTime() - ACTIVITY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * カーソル（最後の行の時刻とID）を文字列にする。
 * @param at - created_at
 * @param id - activity_logs.id
 * @returns カーソル
 */
function encodeCursor(at: Date, id: string): string {
  return btoa(JSON.stringify([at.toISOString(), id])).replace(/=+$/, "");
}

/**
 * カーソルを読む。壊れていれば VALIDATION_FAILED。
 * @param cursor - カーソル
 * @returns 時刻とID
 */
function decodeCursor(cursor: string): { at: Date; id: string } {
  try {
    const [at, id] = JSON.parse(atob(cursor)) as [string, string];
    const date = new Date(at);
    // UUID の形を厳密に確かめる（DBのエラーにしない。PR #9 のCodexレビュー）
    if (Number.isNaN(date.getTime()) || typeof id !== "string" || !isUuid(id)) throw new Error("bad cursor");
    return { at: date, id };
  } catch {
    throw new AppError("VALIDATION_FAILED", 400, "invalid cursor", undefined, ["cursor"]);
  }
}

/**
 * 操作の記録の一覧（FR-052）。90日以内を新しい順に、種類・人で絞り込み、カーソルで続きを読む。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param query - kind・actor・cursor・limit
 * @param now - 現在時刻
 * @returns 行・絞り込みの人の選択肢・続きのカーソル
 */
export async function listActivity(
  db: Db,
  accountId: string,
  query: { kind?: ActivityKind[]; actor?: string; cursor?: string; limit?: number },
  now: Date = new Date(),
) {
  const limit = Math.min(Math.max(query.limit ?? ACTIVITY_PAGE_SIZE, 1), ACTIVITY_PAGE_MAX);
  const since = retentionStart(now);
  const conds = [eq(activityLogs.accountId, accountId), gte(activityLogs.createdAt, since)];
  if (query.kind && query.kind.length > 0) conds.push(inArray(activityLogs.kind, query.kind));
  if (query.actor) conds.push(eq(activityLogs.actorUserId, query.actor));
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    conds.push(
      or(lt(activityLogs.createdAt, c.at), and(eq(activityLogs.createdAt, c.at), lt(activityLogs.id, c.id)))!,
    );
  }
  const rows = await db
    .select()
    .from(activityLogs)
    .where(and(...conds))
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const actors = await db
    .selectDistinctOn([activityLogs.actorUserId], {
      userId: activityLogs.actorUserId,
      name: activityLogs.actorName,
      role: activityLogs.actorRole,
    })
    .from(activityLogs)
    .where(and(eq(activityLogs.accountId, accountId), gte(activityLogs.createdAt, since), sql`${activityLogs.actorUserId} IS NOT NULL`))
    .orderBy(activityLogs.actorUserId, desc(activityLogs.createdAt));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      actor: { userId: r.actorUserId, name: r.actorName, role: r.actorRole },
      kind: r.kind,
      action: r.action,
      itemCount: r.itemCount,
      summary: r.summary,
      details: r.details as Record<string, unknown> | null,
    })),
    actors: actors.map((a) => ({ userId: a.userId!, name: a.name, role: a.role })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/**
 * 90日を過ぎた記録を消す（日次の処理。FR-051）。
 * @param db - データベース
 * @param now - 現在時刻
 * @returns 消した件数
 */
export async function purgeOldActivity(db: Db, now: Date = new Date()) {
  const deleted = await db.delete(activityLogs).where(lt(activityLogs.createdAt, retentionStart(now))).returning({ id: activityLogs.id });
  return { deleted: deleted.length };
}

/**
 * ユーザーの名前を読む（保存の衝突で「（名前）さんが先に保存しました」に使う。research.md R8）。
 * @param db - データベース
 * @param userId - users.id（NULLなら読まない）
 * @returns `{ name }`。不明ならNULL
 */
export async function updatedByOf(db: Db | TxDb, userId: string | null | undefined): Promise<{ name: string } | null> {
  if (!userId) return null;
  const [u] = await db.select({ displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return u ? { name: personName(u) } : null;
}
