// 関わりによる判定（specs/011-team-revision contracts/permissions.md、research.md R3・R4）。
// 「誰がどのAccount（とチーム）で何をできるか」の判定はこのファイルだけに置き、すべてのAPIがここを通す（Constitution原則V）。
// Accountに関わっていない人には、存在の有無を漏らさないよう 404 ACCOUNT_NOT_FOUND を返す（001から同じ）。
// 機能のまとまりのON/OFFの判定もここだけに置く（specs/019-feature-switches research.md R1、Constitution原則V 4.2.0）。
import {
  narrowForReadOnly,
  permissionsFor,
  type Permission,
  type Feature,
  type ReadOnlyReason,
  type Relation,
  type Role,
  type TeamRole,
} from "@meguru/shared";
import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, TxDb } from "../../../kernel/db/client";
import { accounts, memberships, teamAccounts, teamMembers, teams } from "../schema";
import { subscriptions, users } from "../../../platform/schema";
import type { BillingMode } from "../../../kernel/config";
import { AppError, notFound } from "../../../kernel/errors";
import { entitlementFromFacts } from "../../../platform";
import { disabledFeaturesSql, featureOnSql, featuresFrom } from "../../../platform";
import { billingExemptSql, testAccessSql } from "../../../platform";

/** accounts の行。 */
export type AccountRow = typeof accounts.$inferSelect;
/** teams の行。 */
export type TeamRow = typeof teams.$inferSelect;

/**
 * 判定に使うユーザー（認証のミドルウェアが入れる users の行の一部）と、環境の決済のモード
 * （オーナーが読むだけかを決めるのに使う。specs/013 research.md R2）。
 */
export type RequestUser = { id: string; billing: BillingMode };

/** 読むだけの理由（画面の帯。オーナー以外には支払いの詳細を出さない。specs/013 FR-045）。 */
export type AccessReadOnlyReason = ReadOnlyReason | "owner_inactive";

/** 操作の記録に写す、した人の役割（data-model.md「activity_logs」）。 */
export type ActorRole = "owner" | "admin" | "editor" | "member";

/** authorizeAccount の結果。Accountとの関わり・権限と、画面・記録に使う情報。 */
export type AccountAccess = {
  account: AccountRow;
  relation: Relation;
  permissions: ReadonlySet<Permission>;
  /** Accountのオーナー。grower機能（無料体験）はオーナーの登録日時で判定する（specs/002 research.md R3） */
  owner: { id: string; name: string; createdAt: Date };
  /** 判定したユーザーの名前と、操作の記録に写す役割 */
  actor: { id: string; name: string; role: ActorRole };
  /** このAccountが入っているチームと、判定したユーザーのそのチームでのロール。入っていなければNULL */
  team: { id: string; name: string; myRole: TeamRole } | null;
  /** 判定したユーザーが、このAccountのチームの管理者か */
  isTeamAdmin: boolean;
  /** このAccountがチームに入っているか（操作の記録を書く。research.md R8） */
  hasTeam: boolean;
  /** オーナーが読むだけなら、その理由（判定した人がオーナーでなければ owner_inactive）。すべて使えるなら NULL（specs/013） */
  readOnly: { reason: AccessReadOnlyReason } | null;
  /** オーナーの設定でONの機能のまとまり。チームの人もオーナーの設定に従う（specs/019 FR-012） */
  features: ReadonlySet<Feature>;
};

import { isUuid } from "../../../kernel/validate";
export { isUuid };

import { personName } from "../../../platform";
export { personName };

/**
 * 関わりとチームのロールから、操作の記録に写す役割を決める（research.md R8）。
 * @param relation - Accountとの関わり
 * @param teamRole - そのチームでのロール（チームに入っていなければNULL）
 * @returns 記録に写す役割
 */
function actorRoleOf(relation: Relation, teamRole: TeamRole | null): ActorRole {
  if (relation === "owner") return "owner";
  if (teamRole === "admin") return "admin";
  if (relation === "assigned") return "editor";
  return "member";
}

/**
 * ユーザーがAccountで、その権限の操作をしてよいかを判定する（contracts/permissions.md「関わり」）。
 * 1回の問い合わせで、Account・自分の memberships・オーナー・チーム・自分のチームでのロールを読み、
 * オーナー → 担当の人 → 見せてもらっている人 の順に決める。どれでもなければ ACCOUNT_NOT_FOUND。
 * @param db - データベース（トランザクションの中でもよい）
 * @param user - リクエストしたユーザー
 * @param accountId - accounts.id
 * @param permission - 要る権限
 * @param opts - feature：その操作が属する機能のまとまり（オーナーの設定でOFFなら拒む。specs/019）
 * @returns AccountAccess
 * @throws AppError ACCOUNT_NOT_FOUND（IDの形が違う・存在しない・関わっていない）、FEATURE_DISABLED（まとまりがOFF）、
 *   ROLE_FORBIDDEN（権限が足りない）
 */
export async function authorizeAccount(
  db: Db | TxDb,
  user: RequestUser,
  accountId: string,
  permission: Permission,
  opts: { feature?: Feature } = {},
): Promise<AccountAccess> {
  if (!isUuid(accountId)) throw notFound();
  const own = alias(memberships, "own_m");
  const ownerM = alias(memberships, "owner_m");
  const ownerU = alias(users, "owner_u");
  const meU = alias(users, "me_u");
  const [row] = await db
    .select({
      account: accounts,
      ownRole: own.role,
      ownTeamId: own.teamId,
      ownerId: ownerU.id,
      ownerDisplayName: ownerU.displayName,
      ownerEmail: ownerU.email,
      ownerCreatedAt: ownerU.createdAt,
      ownerLegacyTrial: ownerU.legacyTrial,
      ownerBillingExempt: billingExemptSql(ownerU, user.billing),
      // オーナーがテスト版に入れるか（specs/016 research.md R4）。OFFの環境では読まない
      ownerTestAccess: user.billing.testGroups ? testAccessSql(ownerU, user.billing.operators) : sql<boolean>`true`,
      // オーナーの使えないまとまり（人 ∪ グループ。行がなければすべてON。specs/019 research.md R10）
      ownerDisabled: disabledFeaturesSql(ownerU.id),
      // チーム経由の関わりは、見る人もチームを使えるときだけ（specs/019 FR-009）
      meTeamOn: featureOnSql(meU.id, "team"),
      subStatus: subscriptions.status,
      subCancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      meDisplayName: meU.displayName,
      meEmail: meU.email,
      teamId: teamAccounts.teamId,
      shared: teamAccounts.shared,
      teamName: teams.name,
      myTeamRole: teamMembers.role,
    })
    .from(accounts)
    .innerJoin(ownerM, and(eq(ownerM.accountId, accounts.id), eq(ownerM.role, "owner")))
    .innerJoin(ownerU, eq(ownerU.id, ownerM.userId))
    .innerJoin(meU, eq(meU.id, user.id))
    // オーナーの契約（specs/013 research.md R2。決済による制限はこの判定に足す。Constitution原則V）
    .leftJoin(subscriptions, eq(subscriptions.userId, ownerU.id))
    .leftJoin(own, and(eq(own.accountId, accounts.id), eq(own.userId, user.id)))
    .leftJoin(teamAccounts, eq(teamAccounts.accountId, accounts.id))
    .leftJoin(teams, eq(teams.id, teamAccounts.teamId))
    .leftJoin(teamMembers, and(eq(teamMembers.teamId, teamAccounts.teamId), eq(teamMembers.userId, user.id)))
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!row) throw notFound();
  const inTeam = row.teamId !== null && row.myTeamRole !== null;
  let relation: Relation;
  if (row.ownRole === "owner") relation = "owner";
  // 担当は、そのアカウントのチームの人で、同じチーム経由の行だけ（抜けた・外れた後に残った行では開けない）
  else if (row.ownRole === "editor" && inTeam && row.ownTeamId === row.teamId) relation = "assigned";
  else if (inTeam && row.shared) relation = "shared_viewer";
  else throw notFound();
  // まとまりの判定は、関わりを決めたあと（404 を先に返し、Accountの有無を漏らさない）、ロール・決済の前（contracts/api.md）
  const features = featuresFrom(row.ownerDisabled);
  // オーナーか見る人がチームを使えなければ、チーム経由の関わりはないのと同じ（チームを抜けたのと同じに見せる。FR-009・FR-012）
  if (relation !== "owner" && (!features.has("team") || !row.meTeamOn)) throw notFound();
  if (opts.feature && !features.has(opts.feature)) throw featureDisabled(opts.feature);
  const isTeamAdmin = row.myTeamRole === "admin";
  const byRelation = permissionsFor(relation, { isTeamAdmin });
  if (!byRelation.has(permission)) {
    throw new AppError("ROLE_FORBIDDEN", 403, "role forbidden", undefined, [permission]);
  }
  // オーナーが読むだけなら、だれの操作でも読む・見る・記録・削除だけにする（specs/013 FR-040・FR-042）
  const owner = entitlementFromFacts(user.billing, {
    createdAt: row.ownerCreatedAt,
    legacyTrial: row.ownerLegacyTrial,
    billingExempt: row.ownerBillingExempt,
    status: row.subStatus,
    cancelAtPeriodEnd: row.subCancelAtPeriodEnd,
    testAccess: row.ownerTestAccess,
  });
  const readOnly =
    owner.fullAccess || owner.readOnlyReason === null
      ? null
      : { reason: relation === "owner" ? owner.readOnlyReason : ("owner_inactive" as const) };
  const permissions = readOnly ? narrowForReadOnly(byRelation) : byRelation;
  if (!permissions.has(permission)) {
    throw new AppError("BILLING_REQUIRED", 403, "billing required", undefined, [readOnly!.reason]);
  }
  return {
    account: row.account,
    relation,
    permissions,
    owner: {
      id: row.ownerId,
      name: personName({ displayName: row.ownerDisplayName, email: row.ownerEmail }),
      createdAt: row.ownerCreatedAt,
    },
    actor: {
      id: user.id,
      name: personName({ displayName: row.meDisplayName, email: row.meEmail }),
      role: actorRoleOf(relation, row.myTeamRole),
    },
    team: row.teamId !== null && row.teamName !== null ? { id: row.teamId, name: row.teamName, myRole: row.myTeamRole ?? "member" } : null,
    isTeamAdmin,
    hasTeam: row.teamId !== null,
    readOnly,
    features,
  };
}

/** チームの人であることの判定の結果（contracts/permissions.md「チームのAPIの判定」）。 */
export type TeamAccess = { team: TeamRow; member: { id: string; name: string; role: TeamRole } };

/**
 * ログインした人がチームの人かを判定する。
 * @param db - データベース（トランザクションの中でもよい）
 * @param user - リクエストしたユーザー
 * @param teamId - teams.id
 * @param opts - lock：チームの行を FOR UPDATE で取る（人数を数える・ロールや担当を書くとき。research.md R7）
 * @returns TeamAccess
 * @throws AppError TEAM_NOT_FOUND（IDの形が違う・チームがない・チームの人でない）、FEATURE_DISABLED（チームを使えない）
 */
export async function authorizeTeamMember(
  db: Db | TxDb,
  user: Pick<RequestUser, "id">,
  teamId: string,
  opts: { lock?: boolean } = {},
): Promise<TeamAccess> {
  if (!isUuid(teamId)) throw teamNotFound();
  if (opts.lock) {
    // 先にチームの行だけに鍵をかけ、待った後の最新のチームの人とロールを次の文で読む
    // （結合したまま FOR UPDATE で待つと、待つ前のロールのまま判定してしまう。同時の引き継ぎなど）
    const [locked] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for("update");
    if (!locked) throw teamNotFound();
  }
  const [row] = await db
    .select({
      team: teams,
      role: teamMembers.role,
      displayName: users.displayName,
      email: users.email,
      // チームを使えない人は、チームの画面と操作を使えない（specs/019 FR-009）
      teamOn: featureOnSql(users.id, "team"),
    })
    .from(teams)
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, user.id)))
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!row) throw teamNotFound();
  if (!row.teamOn) throw featureDisabled("team");
  return { team: row.team, member: { id: user.id, name: personName(row), role: row.role } };
}

/**
 * ログインした人がチームの管理者かを判定する。
 * @param db - データベース（トランザクションの中でもよい）
 * @param user - リクエストしたユーザー
 * @param teamId - teams.id
 * @param opts - lock：チームの行を FOR UPDATE で取る
 * @returns TeamAccess
 * @throws AppError TEAM_NOT_FOUND（チームの人でない）、ROLE_FORBIDDEN（チームの人だが管理者でない）
 */
export async function authorizeTeamAdmin(
  db: Db | TxDb,
  user: Pick<RequestUser, "id">,
  teamId: string,
  opts: { lock?: boolean } = {},
): Promise<TeamAccess> {
  const access = await authorizeTeamMember(db, user, teamId, opts);
  if (access.member.role !== "admin") throw new AppError("ROLE_FORBIDDEN", 403, "team admin only");
  return access;
}

/** 運用状況を見る範囲（specs/020 research.md R5）。管理者はすべて、編集者は担当のAccountだけ。 */
export type TeamStatusScope = { kind: "all" } | { kind: "assigned"; accountIds: string[] };

/**
 * チームの人が運用状況を見られる範囲を決める（specs/020 FR-001・FR-002a、research.md R5・R6）。
 * 管理者はすべて。編集者は、同じチーム経由の担当のうち、オーナーがチームのまとまりを使えるAccountだけ
 * （019：チームを使えない人は手伝ってもらえない）。メンバー・担当のない編集者は null。
 * @param db - データベース（トランザクションの中でもよい）
 * @param teamAccess - authorizeTeamMember の結果
 * @returns 範囲（見られなければ null）
 */
export async function statusScopeOf(db: Db | TxDb, teamAccess: TeamAccess): Promise<TeamStatusScope | null> {
  if (teamAccess.member.role === "admin") return { kind: "all" };
  if (teamAccess.member.role !== "editor") return null;
  const ownerM = alias(memberships, "owner_m");
  const rows = await db
    .select({ accountId: memberships.accountId })
    .from(memberships)
    .innerJoin(teamAccounts, and(eq(teamAccounts.accountId, memberships.accountId), eq(teamAccounts.teamId, teamAccess.team.id)))
    .innerJoin(ownerM, and(eq(ownerM.accountId, memberships.accountId), eq(ownerM.role, "owner")))
    .where(
      and(
        eq(memberships.userId, teamAccess.member.id),
        eq(memberships.role, "editor"),
        eq(memberships.teamId, teamAccess.team.id),
        featureOnSql(ownerM.userId, "team"),
      ),
    );
  return rows.length > 0 ? { kind: "assigned", accountIds: rows.map((r) => r.accountId) } : null;
}

/**
 * ログインした人が、チームの運用状況を見られるかを判定する（specs/020 contracts/api.md）。
 * @param db - データベース
 * @param user - リクエストしたユーザー
 * @param teamId - teams.id
 * @returns TeamAccess と範囲
 * @throws AppError TEAM_NOT_FOUND・FEATURE_DISABLED（authorizeTeamMember）、ROLE_FORBIDDEN（メンバー・担当のない編集者）
 */
export async function authorizeTeamStatus(
  db: Db | TxDb,
  user: Pick<RequestUser, "id">,
  teamId: string,
): Promise<TeamAccess & { scope: TeamStatusScope }> {
  const access = await authorizeTeamMember(db, user, teamId);
  const scope = await statusScopeOf(db, access);
  if (!scope) throw new AppError("ROLE_FORBIDDEN", 403, "team admin or assigned editor only");
  return { ...access, scope };
}

/** 担当にしてよいAccount（authorizeAssignment の結果）。 */
export type AssignmentTarget = { account: AccountRow; ownerUserId: string; person: { id: string; role: TeamRole } };

/**
 * その人をAccountの担当にしてよいかを判定する（data-model.md「memberships」、FR-022）。
 * 担当にできるのは、チームのアカウント × そのチームの編集者・管理者で、自分のアカウントは不可。
 * @param db - データベース（トランザクションの中でもよい）
 * @param teamAccess - authorizeTeamAdmin の結果
 * @param personUserId - 担当にする人
 * @param accountId - 担当にするAccount
 * @returns 対象のAccountとオーナー
 * @throws AppError TEAM_NOT_FOUND（相手がチームの人でない・アカウントがチームにない）、ASSIGNMENT_NOT_ALLOWED（メンバー・自分のアカウント）
 */
export async function authorizeAssignment(
  db: Db | TxDb,
  teamAccess: TeamAccess,
  personUserId: string,
  accountId: string,
): Promise<AssignmentTarget> {
  if (!isUuid(personUserId) || !isUuid(accountId)) throw teamNotFound();
  const [person] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamAccess.team.id), eq(teamMembers.userId, personUserId)))
    .limit(1);
  if (!person) throw teamNotFound();
  const ownerM = alias(memberships, "owner_m");
  const [target] = await db
    .select({ account: accounts, ownerUserId: ownerM.userId })
    .from(teamAccounts)
    .innerJoin(accounts, eq(accounts.id, teamAccounts.accountId))
    .innerJoin(ownerM, and(eq(ownerM.accountId, accounts.id), eq(ownerM.role, "owner")))
    .where(and(eq(teamAccounts.teamId, teamAccess.team.id), eq(teamAccounts.accountId, accountId)))
    .limit(1);
  if (!target) throw teamNotFound();
  if (person.role === "member" || target.ownerUserId === personUserId) {
    throw new AppError("ASSIGNMENT_NOT_ALLOWED", 409, "account not assignable");
  }
  return { account: target.account, ownerUserId: target.ownerUserId, person: { id: personUserId, role: person.role } };
}

/**
 * まとまりを使えないことを表すエラーを作る（specs/019 contracts/api.md「新しいエラーコード」）。
 * @param feature - 使えないまとまり
 * @returns 403 FEATURE_DISABLED の AppError
 */
export const featureDisabled = (feature: Feature) => new AppError("FEATURE_DISABLED", 403, "feature disabled", undefined, [feature]);

/**
 * まとまりを使えるかを確かめる（Accountに関わらない操作。チームを作る・招待から入るなど。research.md R13）。
 * @param user - 認証のミドルウェアが入れた、自分の使えるまとまり
 * @param feature - まとまり
 * @throws AppError FEATURE_DISABLED
 */
export function requireFeature(user: { features: ReadonlySet<Feature> }, feature: Feature): void {
  if (!user.features.has(feature)) throw featureDisabled(feature);
}

/**
 * チームが見つからない（チームの人ではない）ことを表すエラーを作る。
 * @returns 404 TEAM_NOT_FOUND の AppError
 */
export const teamNotFound = () => new AppError("TEAM_NOT_FOUND", 404, "team not found");

/** 画面に出す、このAccountでの役割（viewer は見せてもらっている人）。 */
export type SummaryRole = Role | "viewer";

/**
 * 関わりを、画面に出す役割にする。
 * @param relation - Accountとの関わり
 * @returns 役割
 */
export function summaryRoleOf(relation: Relation): SummaryRole {
  return relation === "owner" ? "owner" : relation === "assigned" ? "editor" : "viewer";
}

/**
 * Account の行を、画面に出す AccountSummary にする。
 * @param a - Account の行
 * @param role - ログインした人の役割
 * @param ownerName - 担当している・見せてもらっているAccountのオーナーの名前（自分のAccountならNULL）
 * @returns AccountSummary
 */
export function toAccountSummary(a: AccountRow, role: SummaryRole = "owner", ownerName: string | null = null) {
  return {
    id: a.id,
    name: a.name,
    username: a.username,
    displayName: a.displayName,
    profilePictureUrl: a.profilePictureUrl,
    connectionStatus: a.connectionStatus,
    lastUsedAt: a.lastUsedAt ? a.lastUsedAt.toISOString() : null,
    role,
    ownerName,
    connectionMethod: a.connectionMethod,
    reconnectHint: a.reconnectHint === "short_lived_token" ? ("short_lived_token" as const) : null,
  };
}
