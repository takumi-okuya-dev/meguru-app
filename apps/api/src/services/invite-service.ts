// 招待リンク（specs/008-team-operations research.md R4・R7、contracts/api.md「パートナーの招待」「招待の確認と参加」）。
// 文字列は推測できない乱数。照合はハッシュ、再表示は暗号化した写しで行い、平文は保存しない。
// memberships の partner・editor の行は、このファイルと team-service.ts 以外から書かない。
import { TEAM_EDITOR_LIMIT, countChars } from "@threads-grower/shared";
import { and, count, eq } from "drizzle-orm";
import type { Env } from "../env";
import { createDb, withTransaction, type Db, type TxDb } from "../db/client";
import { accountPartnerInvites, accountPartners, accounts, memberships, teamEditors, teams, users } from "../db/schema";
import { createTokenCipher } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { sha256Hex } from "../lib/identifier-hash";
import { personName, type AccountAccess } from "./access";
import { insertActivity, recordActivity } from "./activity-log";

/** 招待の種類。文字列の先頭（p_・e_）で見分ける。 */
export type InviteKind = "partner" | "editor";

const PREFIX: Record<InviteKind, string> = { partner: "p_", editor: "e_" };

/**
 * 招待の文字列を作る。32バイトの暗号学的乱数の base64url（43文字）に、種類の接頭辞を付ける（research.md R4）。
 * @param kind - 招待の種類
 * @returns 招待の文字列
 */
export function newInviteToken(kind: InviteKind): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return PREFIX[kind] + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 招待の文字列から種類を読む。形が違えばNULL。
 * @param token - 招待の文字列
 * @returns 種類
 */
function kindOf(token: string): InviteKind | null {
  if (!/^[pe]_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return token.startsWith("p_") ? "partner" : "editor";
}

/**
 * 招待のURL（WEB_ORIGIN/invite/{token}）。
 * @param env - Workers のバインディング
 * @param token - 招待の文字列
 * @returns URL
 */
export function inviteUrl(env: Env, token: string): string {
  // 末尾の「/」を除いてからつなぐ（二重スラッシュにしない。threads-connect と同じ。PR #9 のCodexレビュー）
  return `${env.WEB_ORIGIN.replace(/\/+$/, "")}/invite/${token}`;
}

/**
 * 招待の文字列を、保存する形（照合用のハッシュと暗号化した写し）にする。暗号の AAD には持ち主（Account・チーム）のIDを使う。
 * @param env - Workers のバインディング
 * @param token - 招待の文字列
 * @param ownerId - 持ち主のID（Accountの招待はaccountId、チームの招待はteamId）
 * @returns 保存する値
 */
export async function sealInviteToken(env: Env, token: string, ownerId: string) {
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  const sealed = await cipher.encrypt(token, ownerId);
  return { hash: await sha256Hex(token), ciphertext: sealed.ciphertext, iv: sealed.iv, keyVersion: sealed.keyVersion };
}

/**
 * 暗号化した写しから招待の文字列を戻す。
 * @param env - Workers のバインディング
 * @param sealed - 暗号文・IV・鍵の版
 * @param ownerId - 持ち主のID
 * @returns 招待の文字列
 */
export async function openInviteToken(
  env: Env,
  sealed: { ciphertext: Uint8Array; iv: Uint8Array; keyVersion: number },
  ownerId: string,
): Promise<string> {
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  return cipher.decrypt(sealed, ownerId);
}

/**
 * 使えない招待リンクのエラーを作る（作り直された・取り消された・すでにパートナーが参加しているなど。FR-017）。
 * @returns 404 INVITE_INVALID の AppError
 */
export const inviteInvalid = () => new AppError("INVITE_INVALID", 404, "invite invalid");

// ---- パートナーの招待（オーナー）----

/**
 * パートナーの招待リンクを読む。なければNULL。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns URL と作った日時
 */
export async function getPartnerInvite(env: Env, db: Db | TxDb, accountId: string) {
  const [row] = await db
    .select()
    .from(accountPartnerInvites)
    .where(eq(accountPartnerInvites.accountId, accountId))
    .limit(1);
  if (!row) return null;
  const token = await openInviteToken(
    env,
    { ciphertext: row.tokenCiphertext, iv: row.tokenIv, keyVersion: row.keyVersion },
    accountId,
  );
  return { url: inviteUrl(env, token), createdAt: row.createdAt.toISOString() };
}

/**
 * パートナーの招待リンクを作る。あればそのまま返し、rotate なら文字列を差し替える（FR-010・FR-011）。
 * @param env - Workers のバインディング
 * @param access - オーナーの判定の結果
 * @param opts - rotate：作り直す
 * @returns URL と作った日時
 * @throws AppError PARTNER_ALREADY_EXISTS（パートナーがいる）
 */
export async function upsertPartnerInvite(env: Env, access: AccountAccess, opts: { rotate?: boolean } = {}) {
  const accountId = access.account.id;
  return withTransaction(env.DATABASE_URL, async (tx) => {
    // 同じAccountの招待の作成・参加を直列にする
    await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).for("update");
    const [partner] = await tx
      .select({ teamId: accountPartners.teamId })
      .from(accountPartners)
      .where(eq(accountPartners.accountId, accountId))
      .limit(1);
    if (partner) throw new AppError("PARTNER_ALREADY_EXISTS", 409, "partner already exists");
    const existing = await getPartnerInvite(env, tx, accountId);
    if (existing && !opts.rotate) return existing;
    const sealed = await sealInviteToken(env, newInviteToken("partner"), accountId);
    const now = new Date();
    const values = {
      tokenHash: sealed.hash,
      tokenCiphertext: sealed.ciphertext,
      tokenIv: sealed.iv,
      keyVersion: sealed.keyVersion,
      createdByUserId: access.actor.id,
      createdAt: now,
    };
    await tx
      .insert(accountPartnerInvites)
      .values({ accountId, ...values })
      .onConflictDoUpdate({ target: accountPartnerInvites.accountId, set: values });
    // パートナーがいないAccountでも記録する（チームの始まりの経緯を残す。contracts/api.md「操作の記録のコード」）
    await recordActivity(tx, access, {
      kind: "member",
      action: existing ? "partner_invite_rotated" : "partner_invite_created",
      force: true,
    });
    return (await getPartnerInvite(env, tx, accountId))!;
  });
}

/**
 * パートナーの招待リンクを取り消す。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns 取り消したなら true
 */
export async function cancelPartnerInvite(db: Db | TxDb, accountId: string): Promise<boolean> {
  const deleted = await db
    .delete(accountPartnerInvites)
    .where(eq(accountPartnerInvites.accountId, accountId))
    .returning();
  return deleted.length > 0;
}

// ---- 確認と参加 ----

/** 招待を開いた人（ログインしていなければNULL）。 */
type Viewer = { id: string } | null;

/**
 * 招待の確認画面の情報（ログイン不要。contracts/api.md「GET /api/invites/:token」）。
 * @param env - Workers のバインディング
 * @param token - 招待の文字列
 * @param viewer - ログインしていればその人
 * @returns 確認画面の情報
 * @throws AppError INVITE_INVALID（見つからない）
 */
export async function previewInvite(env: Env, token: string, viewer: Viewer) {
  const kind = kindOf(token);
  if (!kind) throw inviteInvalid();
  const db = createDb(env.DATABASE_URL);
  const hash = await sha256Hex(token);
  const viewerTeam = viewer ? await teamOf(db, viewer.id) : null;
  if (kind === "partner") {
    const [row] = await db
      .select({
        account: accounts,
        ownerId: users.id,
        ownerDisplayName: users.displayName,
        ownerEmail: users.email,
        partnerTeamId: accountPartners.teamId,
      })
      .from(accountPartnerInvites)
      .innerJoin(accounts, eq(accounts.id, accountPartnerInvites.accountId))
      .innerJoin(memberships, and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")))
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(accountPartners, eq(accountPartners.accountId, accounts.id))
      .where(eq(accountPartnerInvites.tokenHash, hash))
      .limit(1);
    if (!row || row.partnerTeamId !== null) throw inviteInvalid();
    let status: "anonymous" | "can_join" | "already_member" | "self" = "anonymous";
    if (viewer) {
      if (row.ownerId === viewer.id) status = "self";
      else if (await hasMembership(db, viewer.id, row.account.id)) status = "already_member";
      else status = "can_join";
    }
    return {
      kind,
      account: {
        displayName: row.account.displayName,
        username: row.account.username,
        profilePictureUrl: row.account.profilePictureUrl,
      },
      inviterName: personName({ displayName: row.ownerDisplayName, email: row.ownerEmail }),
      team: null,
      viewer: {
        status,
        accountId: status === "already_member" ? row.account.id : null,
        needsTeamName: status === "can_join" && viewerTeam === null,
      },
    };
  }
  const [team] = await db
    .select({ team: teams, partnerDisplayName: users.displayName, partnerEmail: users.email })
    .from(teams)
    .innerJoin(users, eq(users.id, teams.partnerUserId))
    .where(eq(teams.editorInviteTokenHash, hash))
    .limit(1);
  if (!team) throw inviteInvalid();
  const editors = await editorCount(db, team.team.id);
  let status: "anonymous" | "can_join" | "already_member" | "self" | "limit_reached" = "anonymous";
  if (viewer) {
    if (team.team.partnerUserId === viewer.id) status = "self";
    else if (await isTeamEditor(db, team.team.id, viewer.id)) status = "already_member";
    else if (editors >= TEAM_EDITOR_LIMIT) status = "limit_reached";
    else status = "can_join";
  }
  const partnerName = personName({ displayName: team.partnerDisplayName, email: team.partnerEmail });
  return {
    kind,
    account: null,
    inviterName: partnerName,
    team: { name: team.team.name, partnerName, editorsRemaining: Math.max(0, TEAM_EDITOR_LIMIT - editors) },
    viewer: { status, accountId: null, needsTeamName: false },
  };
}

/**
 * 招待に参加する（research.md R7）。1つのトランザクションで、招待の行（またはチームの行）に鍵をかけて行う。
 * @param env - Workers のバインディング
 * @param user - ログインした人
 * @param token - 招待の文字列
 * @param teamName - 初めてパートナーになるときのチーム名（空ならNULL）
 * @returns 種類と、パートナーなら手伝うAccountのID
 * @throws AppError INVITE_INVALID・INVITE_SELF・INVITE_ALREADY_MEMBER・PARTNER_ALREADY_EXISTS・TEAM_EDITOR_LIMIT
 */
export async function acceptInvite(env: Env, user: { id: string }, token: string, teamName: string | undefined) {
  const kind = kindOf(token);
  if (!kind) throw inviteInvalid();
  const hash = await sha256Hex(token);
  return withTransaction(env.DATABASE_URL, async (tx) => {
    if (kind === "partner") {
      // リンクの作り直し（upsertPartnerInvite）と同じ「Account の行 → 招待の行」の順で鍵をかけ、
      // 鍵をかけた後に文字列をもう一度確かめる（デッドロックを避ける。PR #9 のCodexレビュー）
      const [found] = await tx
        .select({ accountId: accountPartnerInvites.accountId })
        .from(accountPartnerInvites)
        .where(eq(accountPartnerInvites.tokenHash, hash))
        .limit(1);
      if (!found) throw inviteInvalid();
      await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, found.accountId)).for("update");
      const [invite] = await tx
        .select({ accountId: accountPartnerInvites.accountId })
        .from(accountPartnerInvites)
        .where(and(eq(accountPartnerInvites.tokenHash, hash), eq(accountPartnerInvites.accountId, found.accountId)))
        .for("update");
      if (!invite) throw inviteInvalid();
      const accountId = invite.accountId;
      const [own] = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.accountId, accountId), eq(memberships.userId, user.id)))
        .limit(1);
      if (own?.role === "owner") throw new AppError("INVITE_SELF", 409, "own account");
      if (own) throw new AppError("INVITE_ALREADY_MEMBER", 409, "already member", undefined, [accountId]);
      const [partner] = await tx
        .select({ teamId: accountPartners.teamId })
        .from(accountPartners)
        .where(eq(accountPartners.accountId, accountId))
        .limit(1);
      if (partner) throw new AppError("PARTNER_ALREADY_EXISTS", 409, "partner already exists");
      const teamId = await ensureTeamFor(tx, user.id, teamName);
      await tx.insert(accountPartners).values({ accountId, teamId });
      await tx.insert(memberships).values({ userId: user.id, accountId, role: "partner", teamId });
      await tx.delete(accountPartnerInvites).where(eq(accountPartnerInvites.accountId, accountId));
      const [me] = await tx
        .select({ displayName: users.displayName, email: users.email, teamName: teams.name })
        .from(users)
        .innerJoin(teams, eq(teams.partnerUserId, users.id))
        .where(eq(users.id, user.id))
        .limit(1);
      await insertActivity(tx, {
        accountId,
        actor: { id: user.id, name: me ? personName(me) : "", role: "partner" },
        kind: "member",
        action: "partner_joined",
        summary: me?.teamName ?? null,
      });
      return { kind, accountId, teamId };
    }
    const [team] = await tx
      .select({ id: teams.id, partnerUserId: teams.partnerUserId })
      .from(teams)
      .where(eq(teams.editorInviteTokenHash, hash))
      .for("update");
    if (!team) throw inviteInvalid();
    if (team.partnerUserId === user.id) throw new AppError("INVITE_SELF", 409, "own team");
    if (await isTeamEditor(tx, team.id, user.id)) throw new AppError("INVITE_ALREADY_MEMBER", 409, "already member");
    if ((await editorCount(tx, team.id)) >= TEAM_EDITOR_LIMIT) {
      throw new AppError("TEAM_EDITOR_LIMIT", 409, "team editor limit");
    }
    await tx.insert(teamEditors).values({ teamId: team.id, userId: user.id });
    return { kind, accountId: null, teamId: team.id };
  });
}

/**
 * パートナーのチームを返す。なければ作る（初めてパートナーになるとき。FR-015）。
 * @param tx - トランザクション
 * @param userId - パートナー
 * @param teamName - チーム名（空ならNULL。すでにチームがあれば使わない）
 * @returns teams.id
 */
async function ensureTeamFor(tx: TxDb, userId: string, teamName: string | undefined): Promise<string> {
  const existing = await teamOf(tx, userId);
  if (existing) return existing.id;
  const name = teamName?.trim() ? teamName.trim() : null;
  if (name && countChars(name) > 50) throw new AppError("VALIDATION_FAILED", 400, "team name too long", undefined, ["teamName"]);
  const [created] = await tx
    .insert(teams)
    .values({ partnerUserId: userId, name })
    .onConflictDoNothing({ target: teams.partnerUserId })
    .returning({ id: teams.id });
  return created?.id ?? (await teamOf(tx, userId))!.id;
}

async function teamOf(db: Db | TxDb, userId: string) {
  const [row] = await db.select({ id: teams.id }).from(teams).where(eq(teams.partnerUserId, userId)).limit(1);
  return row ?? null;
}

async function hasMembership(db: Db | TxDb, userId: string, accountId: string) {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.accountId, accountId)))
    .limit(1);
  return Boolean(row);
}

async function isTeamEditor(db: Db | TxDb, teamId: string, userId: string) {
  const [row] = await db
    .select({ userId: teamEditors.userId })
    .from(teamEditors)
    .where(and(eq(teamEditors.teamId, teamId), eq(teamEditors.userId, userId)))
    .limit(1);
  return Boolean(row);
}

async function editorCount(db: Db | TxDb, teamId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(teamEditors).where(eq(teamEditors.teamId, teamId));
  return Number(row?.n ?? 0);
}

// ---- 編集者の招待（チームのパートナー）----

/**
 * チームの編集者の招待リンクを読む。なければ作る（最初に表示したとき）。rotate なら作り直す（FR-020）。
 * @param env - Workers のバインディング
 * @param teamId - teams.id
 * @param opts - rotate：作り直す
 * @returns URL と作った日時
 */
export async function getOrCreateTeamInvite(env: Env, teamId: string, opts: { rotate?: boolean } = {}) {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
    if (!team) throw new AppError("TEAM_NOT_FOUND", 404, "team not found");
    if (
      !opts.rotate &&
      team.editorInviteTokenCiphertext &&
      team.editorInviteTokenIv &&
      team.editorInviteKeyVersion !== null &&
      team.editorInviteRotatedAt
    ) {
      const token = await openInviteToken(
        env,
        { ciphertext: team.editorInviteTokenCiphertext, iv: team.editorInviteTokenIv, keyVersion: team.editorInviteKeyVersion },
        teamId,
      );
      return { url: inviteUrl(env, token), rotatedAt: team.editorInviteRotatedAt.toISOString() };
    }
    const token = newInviteToken("editor");
    const sealed = await sealInviteToken(env, token, teamId);
    const now = new Date();
    await tx
      .update(teams)
      .set({
        editorInviteTokenHash: sealed.hash,
        editorInviteTokenCiphertext: sealed.ciphertext,
        editorInviteTokenIv: sealed.iv,
        editorInviteKeyVersion: sealed.keyVersion,
        editorInviteRotatedAt: now,
        updatedAt: now,
      })
      .where(eq(teams.id, teamId));
    return { url: inviteUrl(env, token), rotatedAt: now.toISOString() };
  });
}
