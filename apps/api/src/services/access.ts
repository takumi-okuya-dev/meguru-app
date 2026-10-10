// 役割による判定（specs/008-team-operations contracts/permissions.md、research.md R2）。
// 「誰がどのAccount（とチーム）で何をできるか」の判定はこのファイルだけに置き、すべてのAPIがここを通す（Constitution原則V）。
// Accountに関わっていない人には、存在の有無を漏らさないよう 404 ACCOUNT_NOT_FOUND を返す（001から同じ）。
import { permissionsFor, type Delegation, type Permission, type Role } from "@threads-grower/shared";
import { and, eq, exists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, TxDb } from "../db/client";
import { accountPartners, accounts, memberships, teamEditors, teams, users } from "../db/schema";
import { AppError, notFound } from "../lib/errors";

/** accounts の行。 */
export type AccountRow = typeof accounts.$inferSelect;
/** teams の行。 */
export type TeamRow = typeof teams.$inferSelect;

/** 判定に使うユーザー（認証のミドルウェアが入れる users の行の一部）。 */
type RequestUser = { id: string };

/** authorizeAccount の結果。Accountでの役割・権限と、画面・記録に使う情報。 */
export type AccountAccess = {
  account: AccountRow;
  role: Role;
  permissions: ReadonlySet<Permission>;
  /** Accountのオーナー。grower機能（無料体験）はオーナーの登録日時で判定する（research.md R3） */
  owner: { id: string; name: string; createdAt: Date };
  /** 判定したユーザーの名前（操作の記録に写す） */
  actor: { id: string; name: string };
  /** パートナーがいれば、その任せる範囲。いなければNULL */
  delegation: Delegation | null;
  /** 手伝っているチーム（パートナーがいるとき） */
  team: { id: string; name: string | null; partnerName: string } | null;
  /** チームがあるか（パートナーがいる、または編集者が担当している。FR-050） */
  hasTeam: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * UUIDの形かを確かめる（DBに渡す前に。形が違えば「見つからない」にする）。
 * @param value - 確かめる値
 * @returns UUIDの形なら true
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * 画面・記録に出す人の名前。Googleの名前がなければ、メールの@より前（contracts/ui-routes.md）。
 * @param u - users の表示名とメール
 * @returns 名前
 */
export function personName(u: { displayName: string | null; email: string }): string {
  return u.displayName?.trim() || u.email.split("@")[0] || u.email;
}

/**
 * ユーザーがAccountで、その権限の操作をしてよいかを判定する（contracts/permissions.md）。
 * 1回の問い合わせで、Account・自分の役割・オーナー・手伝いの関係・チームの有無を読む。
 * @param db - データベース（トランザクションの中でもよい）
 * @param user - リクエストしたユーザー
 * @param accountId - accounts.id
 * @param permission - 要る権限
 * @returns AccountAccess
 * @throws AppError ACCOUNT_NOT_FOUND（IDの形が違う・存在しない・関わっていない）、ROLE_FORBIDDEN（権限が足りない）
 */
export async function authorizeAccount(
  db: Db | TxDb,
  user: RequestUser,
  accountId: string,
  permission: Permission,
): Promise<AccountAccess> {
  if (!UUID.test(accountId)) throw notFound();
  const own = alias(memberships, "own_m");
  const ownerM = alias(memberships, "owner_m");
  const ownerU = alias(users, "owner_u");
  const meU = alias(users, "me_u");
  const partnerU = alias(users, "partner_u");
  const editorM = alias(memberships, "editor_m");
  const [row] = await db
    .select({
      account: accounts,
      role: own.role,
      ownerId: ownerU.id,
      ownerDisplayName: ownerU.displayName,
      ownerEmail: ownerU.email,
      ownerCreatedAt: ownerU.createdAt,
      meDisplayName: meU.displayName,
      meEmail: meU.email,
      partnerTeamId: accountPartners.teamId,
      delegateReview: accountPartners.delegateReview,
      delegateSettings: accountPartners.delegateSettings,
      teamName: teams.name,
      partnerDisplayName: partnerU.displayName,
      partnerEmail: partnerU.email,
      hasEditor: exists(
        db
          .select({ one: sql`1` })
          .from(editorM)
          .where(and(eq(editorM.accountId, accounts.id), eq(editorM.role, "editor"))),
      ),
    })
    .from(accounts)
    .innerJoin(own, and(eq(own.accountId, accounts.id), eq(own.userId, user.id)))
    .innerJoin(meU, eq(meU.id, own.userId))
    .innerJoin(ownerM, and(eq(ownerM.accountId, accounts.id), eq(ownerM.role, "owner")))
    .innerJoin(ownerU, eq(ownerU.id, ownerM.userId))
    .leftJoin(accountPartners, eq(accountPartners.accountId, accounts.id))
    .leftJoin(teams, eq(teams.id, accountPartners.teamId))
    .leftJoin(partnerU, eq(partnerU.id, teams.partnerUserId))
    .where(eq(accounts.id, accountId))
    .limit(1);
  // 旧プラン4の member は使わない（関わっていない扱い）
  if (!row || (row.role !== "owner" && row.role !== "partner" && row.role !== "editor")) throw notFound();
  const role: Role = row.role;
  const delegation: Delegation | null =
    row.partnerTeamId !== null ? { review: !!row.delegateReview, settings: !!row.delegateSettings } : null;
  const permissions = permissionsFor(role, role === "partner" ? delegation : null);
  if (!permissions.has(permission)) {
    throw new AppError("ROLE_FORBIDDEN", 403, "role forbidden", undefined, [permission]);
  }
  return {
    account: row.account,
    role,
    permissions,
    owner: {
      id: row.ownerId,
      name: personName({ displayName: row.ownerDisplayName, email: row.ownerEmail }),
      createdAt: row.ownerCreatedAt,
    },
    actor: { id: user.id, name: personName({ displayName: row.meDisplayName, email: row.meEmail }) },
    delegation,
    team:
      row.partnerTeamId !== null
        ? {
            id: row.partnerTeamId,
            name: row.teamName,
            partnerName: personName({ displayName: row.partnerDisplayName, email: row.partnerEmail ?? "" }),
          }
        : null,
    hasTeam: row.partnerTeamId !== null || !!row.hasEditor,
  };
}

/** チームのパートナー本人であることの判定の結果（contracts/permissions.md「チームの判定」）。 */
export type TeamAccess = { team: TeamRow; partner: { id: string; name: string } };

/**
 * ログインした人がチームのパートナーかを判定する。
 * @param db - データベース（トランザクションの中でもよい）
 * @param user - リクエストしたユーザー
 * @param opts - lock：チームの行を FOR UPDATE で取る（編集者の数を数えるとき）
 * @returns TeamAccess
 * @throws AppError TEAM_NOT_FOUND（チームのパートナーではない）
 */
export async function authorizeTeam(
  db: Db | TxDb,
  user: RequestUser,
  opts: { lock?: boolean } = {},
): Promise<TeamAccess> {
  const base = db
    .select({ team: teams, displayName: users.displayName, email: users.email })
    .from(teams)
    .innerJoin(users, eq(users.id, teams.partnerUserId))
    .where(eq(teams.partnerUserId, user.id))
    .limit(1);
  const [row] = opts.lock ? await base.for("update", { of: teams }) : await base;
  if (!row) throw teamNotFound();
  return { team: row.team, partner: { id: user.id, name: personName(row) } };
}

/** チームが関われるAccount（listTeamAccounts の1行）。 */
export type TeamAccount = {
  account: AccountRow;
  /** パートナー自身がオーナーのAccount（自社） */
  own: boolean;
  owner: { id: string; name: string };
  /** 手伝う先のときの任せる範囲。自社ならNULL */
  delegation: Delegation | null;
};

/**
 * チームが関われるAccountの一覧（手伝う先と、パートナー自身がオーナーのAccount）。
 * まとめの画面と担当の表の列はこの一覧だけを使う（contracts/permissions.md「チームの判定」）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param teamAccess - authorizeTeam の結果
 * @returns Accountの一覧（自社が先、それぞれ表示名の順）
 */
export async function listTeamAccounts(db: Db | TxDb, teamAccess: TeamAccess): Promise<TeamAccount[]> {
  const ownerM = alias(memberships, "owner_m");
  const ownerU = alias(users, "owner_u");
  const rows = await db
    .select({
      account: accounts,
      ownerId: ownerU.id,
      ownerDisplayName: ownerU.displayName,
      ownerEmail: ownerU.email,
      partnerTeamId: accountPartners.teamId,
      delegateReview: accountPartners.delegateReview,
      delegateSettings: accountPartners.delegateSettings,
    })
    .from(accounts)
    .innerJoin(ownerM, and(eq(ownerM.accountId, accounts.id), eq(ownerM.role, "owner")))
    .innerJoin(ownerU, eq(ownerU.id, ownerM.userId))
    .leftJoin(
      accountPartners,
      and(eq(accountPartners.accountId, accounts.id), eq(accountPartners.teamId, teamAccess.team.id)),
    )
    .where(sql`${accountPartners.teamId} IS NOT NULL OR ${ownerM.userId} = ${teamAccess.partner.id}`);
  const list = rows.map((r) => {
    const own = r.ownerId === teamAccess.partner.id;
    return {
      account: r.account,
      own,
      owner: { id: r.ownerId, name: personName({ displayName: r.ownerDisplayName, email: r.ownerEmail }) },
      delegation:
        !own && r.partnerTeamId !== null ? { review: !!r.delegateReview, settings: !!r.delegateSettings } : null,
    };
  });
  const label = (a: AccountRow) => a.displayName ?? a.username;
  return list.sort((a, b) => Number(b.own) - Number(a.own) || label(a.account).localeCompare(label(b.account), "ja"));
}

/**
 * 編集者をそのAccountの担当にしてよいかを判定する（contracts/permissions.md「チームの判定」）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param teamAccess - authorizeTeam の結果
 * @param editorUserId - 担当にする人
 * @param accountId - 担当にするAccount
 * @returns 対象のAccount（listTeamAccounts の行）
 * @throws AppError TEAM_NOT_FOUND（相手がチームの編集者ではない）、ASSIGNMENT_NOT_ALLOWED（Accountが対象外）
 */
export async function authorizeAssignment(
  db: Db | TxDb,
  teamAccess: TeamAccess,
  editorUserId: string,
  accountId: string,
): Promise<TeamAccount> {
  if (!UUID.test(editorUserId)) throw teamNotFound();
  const [member] = await db
    .select({ userId: teamEditors.userId })
    .from(teamEditors)
    .where(and(eq(teamEditors.teamId, teamAccess.team.id), eq(teamEditors.userId, editorUserId)))
    .limit(1);
  if (!member) throw teamNotFound();
  const target = (await listTeamAccounts(db, teamAccess)).find((a) => a.account.id === accountId);
  if (!target) throw new AppError("ASSIGNMENT_NOT_ALLOWED", 409, "account not assignable");
  return target;
}

/**
 * チームが見つからない（チームのパートナーではない）ことを表すエラーを作る。
 * @returns 404 TEAM_NOT_FOUND の AppError
 */
export const teamNotFound = () => new AppError("TEAM_NOT_FOUND", 404, "team not found");

/**
 * Account の行を、画面に出す AccountSummary にする。
 * @param a - Account の行
 * @param role - ログインした人の役割
 * @param ownerName - 手伝っているAccountのオーナーの名前（自分のAccountならNULL）
 * @returns AccountSummary
 */
export function toAccountSummary(a: AccountRow, role: Role = "owner", ownerName: string | null = null) {
  return {
    id: a.id,
    username: a.username,
    displayName: a.displayName,
    profilePictureUrl: a.profilePictureUrl,
    plan: a.plan,
    connectionStatus: a.connectionStatus,
    lastUsedAt: a.lastUsedAt ? a.lastUsedAt.toISOString() : null,
    role,
    ownerName,
  };
}
