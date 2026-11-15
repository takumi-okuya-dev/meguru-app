// 運営メンバーの招待と、つながった運営メンバーが見る分配（specs/collect/003-revenue-sharing contracts/api.md 1-4・2、
// FR-050〜FR-056、research.md R6・R7）。
// 招待のトークンはハッシュだけを持つ（リンクを見せるのは出したときだけ。見せ直すときは出し直す）。受けた・止めた・出し直したら行を消す。
// つながった人の道筋は、ログインだけを見る（集金管理の利用の許可は見ない）。見せてよいかは sharing_members の user_id で決める。
import {
  SHARING_INVITE_TOKEN_PREFIX,
  SHARING_LIMITS,
  type MemberSharingView,
  type SharedEvent,
  type SharingInviteCreated,
  type SharingInviteInfo,
  type SharingSnapshot,
} from "@meguru/shared";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { withTransaction, type Db, type TxDb } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { AppError, pgErrorCode } from "../../../kernel/errors";
import { sha256Hex } from "../../../kernel/identifier-hash";
import { inviteUrl, newInviteToken } from "../../../kernel/invite-token";
import { isUuid } from "../../../kernel/validate";
import { loadOwnedEvent, type CollectEventRow } from "../access";
import { collectEvents, collectSharingInvites, collectSharingMembers } from "../schema";
import { buildSharingSnapshot, ensureOwnerMember, sharingSnapshot } from "./sharing-service";

/** 招待の画面のパス（画面の /collect/join/:token）。 */
const JOIN_ROUTE = "collect/join";

/**
 * 使えない招待のリンク（ない・期限が過ぎた・受けた・止めた）。
 * @returns 404 INVITE_INACTIVE のエラー
 */
const inviteInactive = () => new AppError("INVITE_INACTIVE", 404, "invite inactive");
/**
 * つながっていない・ないイベント（あるかどうかを見せない）。
 * @returns 404 ITEM_NOT_FOUND のエラー
 */
const shareNotFound = () => new AppError("ITEM_NOT_FOUND", 404, "share not found");
/**
 * もうつながっている。
 * @returns 409 ALREADY_LINKED のエラー
 */
const alreadyLinked = () => new AppError("ALREADY_LINKED", 409, "already linked");

/**
 * 主催者のイベントの運営メンバーを、ロックして読む。
 * @param tx - トランザクション
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param memberId - 運営メンバーの番号
 * @param now - 今
 * @returns イベントと運営メンバーの行
 * @throws AppError ITEM_NOT_FOUND
 */
async function loadOwnedMember(tx: TxDb, ownerUserId: string, eventId: string, memberId: string, now: Date) {
  const event = await loadOwnedEvent(tx, ownerUserId, eventId, { forUpdate: true });
  await ensureOwnerMember(tx, event, now);
  if (!isUuid(memberId)) throw shareNotFound();
  const [member] = await tx
    .select()
    .from(collectSharingMembers)
    .where(and(eq(collectSharingMembers.id, memberId), eq(collectSharingMembers.eventId, event.id)))
    .limit(1);
  if (!member) throw shareNotFound();
  return { event, member };
}

/**
 * 招待のリンクを出す（POST …/members/:memberId/invite。FR-050）。前のリンクは使えなくなる。
 * @param env - Workers のバインディング
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param memberId - 運営メンバーの番号
 * @param now - 今
 * @returns リンクと期限
 * @throws AppError ITEM_NOT_FOUND・ALREADY_LINKED（つながっている・主催者の行）
 */
export async function createInvite(env: Env, ownerUserId: string, eventId: string, memberId: string, now: Date): Promise<SharingInviteCreated> {
  const token = newInviteToken(SHARING_INVITE_TOKEN_PREFIX);
  const expiresAt = new Date(now.getTime() + SHARING_LIMITS.inviteDays * 24 * 3600_000);
  const tokenHash = await sha256Hex(token);
  await withTransaction(env.DATABASE_URL, async (tx) => {
    const { member } = await loadOwnedMember(tx, ownerUserId, eventId, memberId, now);
    if (member.isOwner || member.userId !== null) throw alreadyLinked();
    await tx.delete(collectSharingInvites).where(eq(collectSharingInvites.memberId, member.id));
    await tx.insert(collectSharingInvites).values({ memberId: member.id, tokenHash, expiresAt, createdAt: now });
  });
  return { url: inviteUrl(env, token, JOIN_ROUTE), expiresAt: expiresAt.toISOString() };
}

/**
 * 招待のリンクを止める（DELETE …/members/:memberId/invite）。
 * @param databaseUrl - 接続文字列
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param eventId - イベントの番号
 * @param memberId - 運営メンバーの番号
 * @param now - 今
 * @returns 分配の画面の数字
 * @throws AppError ITEM_NOT_FOUND
 */
export async function stopInvite(databaseUrl: string, db: Db, ownerUserId: string, eventId: string, memberId: string, now: Date): Promise<SharingSnapshot> {
  await withTransaction(databaseUrl, async (tx) => {
    const { member } = await loadOwnedMember(tx, ownerUserId, eventId, memberId, now);
    await tx.delete(collectSharingInvites).where(eq(collectSharingInvites.memberId, member.id));
  });
  return sharingSnapshot(db, ownerUserId, eventId, now);
}

/**
 * 使える招待を、運営メンバーとイベントと一緒に読む。
 * @param db - データベース（トランザクションの中でもよい）
 * @param token - 招待の文字列
 * @param now - 今
 * @param forUpdate - 招待の行をロックする（受けるとき）
 * @returns 招待・運営メンバー・イベント
 * @throws AppError INVITE_INACTIVE
 */
async function loadInvite(db: Db | TxDb, token: string, now: Date, forUpdate = false) {
  if (!token.startsWith(SHARING_INVITE_TOKEN_PREFIX)) throw inviteInactive();
  const q = db
    .select({ invite: collectSharingInvites, member: collectSharingMembers, event: collectEvents })
    .from(collectSharingInvites)
    .innerJoin(collectSharingMembers, eq(collectSharingMembers.id, collectSharingInvites.memberId))
    .innerJoin(collectEvents, eq(collectEvents.id, collectSharingMembers.eventId))
    .where(and(eq(collectSharingInvites.tokenHash, await sha256Hex(token)), gt(collectSharingInvites.expiresAt, now)))
    .limit(1);
  const [row] = await (forUpdate ? q.for("update") : q);
  if (!row) throw inviteInactive();
  return row;
}

/**
 * 開いた人が、そのイベントでもうつながっているか。
 * @param db - データベース（トランザクションの中でもよい）
 * @param eventId - イベントの番号
 * @param userId - 開いた人
 * @returns つながっていれば true
 */
async function linkedInEvent(db: Db | TxDb, eventId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: collectSharingMembers.id })
    .from(collectSharingMembers)
    .where(and(eq(collectSharingMembers.eventId, eventId), eq(collectSharingMembers.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/**
 * 招待の中身（GET /invites/:token）。
 * @param db - データベース
 * @param userId - 開いた人
 * @param token - 招待の文字列
 * @param now - 今
 * @returns イベントの名前と日・運営メンバーの名前・受けられるか
 * @throws AppError INVITE_INACTIVE
 */
export async function getInvite(db: Db, userId: string, token: string, now: Date): Promise<SharingInviteInfo> {
  const { member, event } = await loadInvite(db, token, now);
  return {
    event: { name: event.name, startsAt: event.startsAt.toISOString() },
    memberName: member.name,
    ownerIsYou: event.ownerUserId === userId,
    alreadyLinked: await linkedInEvent(db, event.id, userId),
  };
}

/**
 * 招待を受ける（POST /invites/:token/accept。FR-051・FR-052）。受けたらリンクは使えなくなる。
 * @param databaseUrl - 接続文字列
 * @param userId - 受ける人
 * @param token - 招待の文字列
 * @param now - 今
 * @returns イベントの番号
 * @throws AppError INVITE_INACTIVE・ALREADY_LINKED（主催者自身・同じイベントでつながっている）
 */
export async function acceptInvite(databaseUrl: string, userId: string, token: string, now: Date): Promise<{ eventId: string }> {
  try {
    return await withTransaction(databaseUrl, async (tx) => {
      const { invite, member, event } = await loadInvite(tx, token, now, true);
      if (event.ownerUserId === userId) throw alreadyLinked();
      const updated = await tx
        .update(collectSharingMembers)
        .set({ userId, linkedAt: now })
        .where(and(eq(collectSharingMembers.id, member.id), isNull(collectSharingMembers.userId)))
        .returning({ id: collectSharingMembers.id });
      if (updated.length === 0) throw alreadyLinked();
      await tx.delete(collectSharingInvites).where(eq(collectSharingInvites.id, invite.id));
      return { eventId: event.id };
    });
  } catch (err) {
    // 同じイベントでもうつながっている（部分一意索引）
    if (pgErrorCode(err) === "23505") throw alreadyLinked();
    throw err;
  }
}

/**
 * 開いた人がつながったイベントを読む（主催者の行は除く。主催者は主催者の画面で見る）。
 * @param db - データベース
 * @param userId - 開いた人
 * @param eventId - イベントの番号（省けばすべて）
 * @returns 運営メンバーとイベントの行
 */
async function linkedRows(db: Db, userId: string, eventId?: string) {
  return db
    .select({ member: collectSharingMembers, event: collectEvents })
    .from(collectSharingMembers)
    .innerJoin(collectEvents, eq(collectEvents.id, collectSharingMembers.eventId))
    .where(and(eq(collectSharingMembers.userId, userId), eq(collectSharingMembers.isOwner, false), eventId ? eq(collectEvents.id, eventId) : undefined))
    .orderBy(desc(collectEvents.startsAt));
}

/**
 * 運営メンバーの受け取る合計（分配額＋立て替えの戻し。赤字なら負担の目安）。
 * @param snap - 分配の画面の数字
 * @param memberId - 運営メンバーの番号
 * @returns 額
 */
function totalOf(snap: SharingSnapshot, memberId: string): number {
  const share = snap.current.shares.find((s) => s.memberId === memberId)?.total ?? 0;
  const back = snap.reimbursements.find((r) => r.memberId === memberId)?.amount ?? 0;
  return snap.current.deficit ? share : share + back;
}

/**
 * つながったイベントの一覧（GET /shares。FR-054）。
 * @param db - データベース
 * @param userId - 開いた人
 * @param now - 今
 * @returns イベントの一覧（日の新しい順）
 */
export async function listShares(db: Db, userId: string, now: Date): Promise<SharedEvent[]> {
  const rows = await linkedRows(db, userId);
  const out: SharedEvent[] = [];
  for (const { member, event } of rows) {
    const snap = await buildSharingSnapshot(db, event as CollectEventRow, now);
    out.push({ eventId: event.id, name: event.name, startsAt: event.startsAt.toISOString(), memberName: member.name, total: totalOf(snap, member.id), deficit: snap.current.deficit });
  }
  return out;
}

/**
 * つながったイベントの分配（GET /shares/:eventId。FR-053）。名簿・参加者・紹介は入れない。招待の情報も外す。
 * @param db - データベース
 * @param userId - 開いた人
 * @param eventId - イベントの番号
 * @param now - 今
 * @returns 読むだけの分配
 * @throws AppError ITEM_NOT_FOUND（つながっていない）
 */
export async function memberSharingView(db: Db, userId: string, eventId: string, now: Date): Promise<MemberSharingView> {
  if (!isUuid(eventId)) throw shareNotFound();
  const [row] = await linkedRows(db, userId, eventId);
  if (!row) throw shareNotFound();
  const snap = await buildSharingSnapshot(db, row.event as CollectEventRow, now);
  return { ...snap, members: snap.members.map(({ invite: _invite, ...m }) => m), you: row.member.id };
}
