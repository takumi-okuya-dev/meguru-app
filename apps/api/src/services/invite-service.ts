// チームの招待リンク（specs/011-team-revision contracts/api.md「招待の確認と参加」。仕組みは specs/008 research.md R4）。
// 文字列は推測できない乱数。照合はハッシュ、再表示は暗号化した写しで行い、平文は保存しない。
// team_members・team_accounts は、このファイルと team-service.ts 以外から書かない（tasks.md Notes）。
import { TEAM_MEMBER_LIMIT } from "@threads-grower/shared";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Env } from "../env";
import { createDb, withTransaction, type Db, type TxDb } from "../db/client";
import { accounts, memberships, teamAccounts, teamMembers, teams, users } from "../db/schema";
import { createTokenCipher } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { sha256Hex } from "../lib/identifier-hash";
import { personName } from "./access";
import { insertActivity } from "./activity-log";

const PREFIX = "t_";
const TOKEN_FORM = /^t_[A-Za-z0-9_-]{43}$/;

/**
 * チームの招待の文字列を作る。32バイトの暗号学的乱数の base64url（43文字）に「t_」を付ける。
 * @returns 招待の文字列
 */
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return PREFIX + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 招待のURL（WEB_ORIGIN/invite/{token}）。
 * @param env - Workers のバインディング
 * @param token - 招待の文字列
 * @returns URL
 */
export function inviteUrl(env: Env, token: string): string {
  // 末尾の「/」を除いてからつなぐ（二重スラッシュにしない。PR #9 のCodexレビュー）
  return `${env.WEB_ORIGIN.replace(/\/+$/, "")}/invite/${token}`;
}

/**
 * 招待の文字列を、保存する形（照合用のハッシュと暗号化した写し）にする。暗号の AAD にはチームのIDを使う。
 * @param env - Workers のバインディング
 * @param token - 招待の文字列
 * @param teamId - teams.id
 * @returns 保存する値
 */
export async function sealInviteToken(env: Env, token: string, teamId: string) {
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  const sealed = await cipher.encrypt(token, teamId);
  return { hash: await sha256Hex(token), ciphertext: sealed.ciphertext, iv: sealed.iv, keyVersion: sealed.keyVersion };
}

/**
 * 暗号化した写しから招待の文字列を戻す。
 * @param env - Workers のバインディング
 * @param sealed - 暗号文・IV・鍵の版
 * @param teamId - teams.id
 * @returns 招待の文字列
 */
export async function openInviteToken(
  env: Env,
  sealed: { ciphertext: Uint8Array; iv: Uint8Array; keyVersion: number },
  teamId: string,
): Promise<string> {
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  return cipher.decrypt(sealed, teamId);
}

/**
 * 使えない招待リンクのエラーを作る（作り直された・チームが削除された。FR-016）。
 * @returns 404 INVITE_INVALID の AppError
 */
export const inviteInvalid = () => new AppError("INVITE_INVALID", 404, "invite invalid");

/** 招待を開いた人（ログインしていなければNULL）。 */
type Viewer = { id: string } | null;

/**
 * 利用者がオーナーのアカウントと、ほかのチームに入っていればそのチーム名。
 * @param db - データベース
 * @param userId - users.id
 * @returns アカウントの一覧（表示名の順）
 */
async function ownedAccountsWithTeam(db: Db | TxDb, userId: string) {
  const rows = await db
    .select({ account: accounts, teamName: teams.name })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .leftJoin(teamAccounts, eq(teamAccounts.accountId, accounts.id))
    .leftJoin(teams, eq(teams.id, teamAccounts.teamId))
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")))
    .orderBy(asc(accounts.createdAt));
  return rows.map((r) => ({
    id: r.account.id,
    name: r.account.name,
    displayName: r.account.displayName,
    username: r.account.username,
    profilePictureUrl: r.account.profilePictureUrl,
    connected: r.account.connectionStatus !== "not_connected",
    inOtherTeam: r.teamName,
  }));
}

/**
 * チームの人数。
 * @param db - データベース
 * @param teamId - teams.id
 * @returns 人数
 */
export async function memberCount(db: Db | TxDb, teamId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(teamMembers).where(eq(teamMembers.teamId, teamId));
  return Number(row?.n ?? 0);
}

/**
 * 招待の確認画面の情報（ログイン不要。contracts/api.md「GET /api/invites/:token」）。
 * @param env - Workers のバインディング
 * @param token - 招待の文字列
 * @param viewer - ログインしていればその人
 * @returns 確認画面の情報
 * @throws AppError INVITE_INVALID（形が違う・見つからない）
 */
export async function previewTeamInvite(env: Env, token: string, viewer: Viewer) {
  if (!TOKEN_FORM.test(token)) throw inviteInvalid();
  const db = createDb(env.DATABASE_URL);
  const adminU = alias(users, "admin_u");
  const [row] = await db
    .select({ team: teams, adminDisplayName: adminU.displayName, adminEmail: adminU.email })
    .from(teams)
    .innerJoin(adminU, eq(adminU.id, teams.adminUserId))
    .where(eq(teams.inviteTokenHash, await sha256Hex(token)))
    .limit(1);
  if (!row) throw inviteInvalid();
  const team = {
    name: row.team.name,
    adminName: personName({ displayName: row.adminDisplayName, email: row.adminEmail }),
    memberCount: await memberCount(db, row.team.id),
  };
  if (!viewer) return { team, viewer: { status: "anonymous" as const, teamId: null, accounts: [] } };
  const [member] = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, row.team.id), eq(teamMembers.userId, viewer.id)))
    .limit(1);
  if (member) return { team, viewer: { status: "already_member" as const, teamId: row.team.id, accounts: [] } };
  const owned = await ownedAccountsWithTeam(db, viewer.id);
  // チームに入るには、自分のアカウントが1つ以上要る（FR-013）
  if (owned.length === 0) return { team, viewer: { status: "needs_account" as const, teamId: null, accounts: [] } };
  return { team, viewer: { status: "ready" as const, teamId: null, accounts: owned } };
}

/**
 * 選んだアカウントが、利用者がオーナーで、どれもほかのチームに入っていないことを確かめる（FR-013・FR-015）。
 * @param tx - トランザクション
 * @param userId - 利用者
 * @param accountIds - 選んだアカウント
 * @throws AppError TEAM_NEEDS_ACCOUNT（0件）、ACCOUNT_NOT_FOUND（自分のアカウントでない）、ACCOUNT_IN_OTHER_TEAM（ほかのチームに入っている）
 */
export async function assertOwnFreeAccounts(tx: TxDb, userId: string, accountIds: string[]) {
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) throw new AppError("TEAM_NEEDS_ACCOUNT", 409, "no account selected");
  const owned = await tx
    .select({ accountId: memberships.accountId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner"), inArray(memberships.accountId, ids)))
    // 同じアカウントを同時に別のチームへ入れる操作と直列にする（入った後は一意索引でも守る）
    .for("update");
  if (owned.length !== ids.length) throw new AppError("ACCOUNT_NOT_FOUND", 404, "account not owned");
  const inTeam = await tx
    .select({ accountId: teamAccounts.accountId })
    .from(teamAccounts)
    .where(inArray(teamAccounts.accountId, ids));
  if (inTeam.length > 0) {
    throw new AppError("ACCOUNT_IN_OTHER_TEAM", 409, "account in other team", undefined, inTeam.map((r) => r.accountId));
  }
}

/**
 * 招待リンクで参加する（FR-012〜FR-016）。チームの行に鍵をかけてから、人数を数え、メンバーとして入り、
 * 選んだアカウントをチームに入れる。同じ人の同時の参加は、鍵で直列になり1回だけ入る。
 * @param env - Workers のバインディング
 * @param user - ログインした人
 * @param token - 招待の文字列
 * @param selected - 入れるアカウントと、それぞれの「チームに見せる」
 * @returns 入ったチームのID
 * @throws AppError INVITE_INVALID・INVITE_ALREADY_MEMBER・TEAM_NEEDS_ACCOUNT・TEAM_FULL・ACCOUNT_IN_OTHER_TEAM・ACCOUNT_NOT_FOUND
 */
export async function acceptTeamInvite(env: Env, user: { id: string }, token: string, selected: { id: string; shared: boolean }[]) {
  if (!TOKEN_FORM.test(token)) throw inviteInvalid();
  const hash = await sha256Hex(token);
  return withTransaction(env.DATABASE_URL, async (tx) => {
    const [found] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.inviteTokenHash, hash)).limit(1);
    if (!found) throw inviteInvalid();
    // 作り直し・削除と同じくチームの行に鍵をかけ、かけた後に文字列をもう一度確かめる（PR #9 のCodexレビュー）
    const [team] = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, found.id), eq(teams.inviteTokenHash, hash)))
      .for("update");
    if (!team) throw inviteInvalid();
    const [already] = await tx
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, user.id)))
      .limit(1);
    if (already) throw new AppError("INVITE_ALREADY_MEMBER", 409, "already member", undefined, [team.id]);
    if (selected.length === 0) throw new AppError("TEAM_NEEDS_ACCOUNT", 409, "no account selected");
    if ((await memberCount(tx, team.id)) >= TEAM_MEMBER_LIMIT) {
      throw new AppError("TEAM_FULL", 409, "team full", undefined, ["members"]);
    }
    await assertOwnFreeAccounts(
      tx,
      user.id,
      selected.map((a) => a.id),
    );
    await tx.insert(teamMembers).values({ teamId: team.id, userId: user.id, role: "member" });
    const shared = new Map(selected.map((a) => [a.id, a.shared]));
    const now = new Date();
    await tx.insert(teamAccounts).values(
      [...shared].map(([accountId, s]) => ({ teamId: team.id, accountId, addedByUserId: user.id, shared: s, addedAt: now, updatedAt: now })),
    );
    const [me] = await tx.select({ displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, user.id));
    const name = me ? personName(me) : "";
    for (const accountId of shared.keys()) {
      await insertActivity(tx, {
        accountId,
        actor: { id: user.id, name, role: "owner" },
        kind: "member",
        action: "team_member_joined",
        summary: name,
      });
    }
    return { teamId: team.id };
  });
}
