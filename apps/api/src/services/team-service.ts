// チームの書き込みと読み出し（specs/011-team-revision data-model.md、research.md R1・R7・R8・R9）。
// team_members・team_accounts・担当（memberships の editor の行）は、このファイルと invite-service.ts 以外から書かない。
// 権限の判定は access.ts を通す（contracts/permissions.md「チームのAPIの判定」）。
import { TEAM_EDITOR_LIMIT, TEAM_MEMBER_LIMIT, TEAMS_PER_ADMIN, type TeamRole } from "@threads-grower/shared";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Env } from "../env";
import type { Db, TxDb } from "../db/client";
import { accounts, memberships, teamAccounts, teamMembers, teams, users } from "../db/schema";
import { lockAdminTeams } from "../db/locks";
import { AppError } from "../lib/errors";
import { insertActivity } from "./activity-log";
import {
  authorizeAssignment,
  personName,
  teamNotFound,
  type AccountAccess,
  type ActorRole,
  type TeamAccess,
} from "./access";
import { assertOwnFreeAccounts, inviteUrl, newInviteToken, openInviteToken, sealInviteToken } from "./invite-service";

// ---- 記録 ----

/** チームの操作の記録に使う、した人（その時点の名前とロール）。 */
type TeamActor = { id: string; name: string; role: TeamRole };

/**
 * チームの操作を、関わるアカウントに1行ずつ記録する（research.md R8）。した人がそのアカウントのオーナーなら owner、
 * ほかは管理者なら admin、編集者なら editor、メンバーなら member。
 * @param tx - その操作と同じトランザクション
 * @param actor - した人
 * @param accountIds - 記録するアカウント
 * @param input - 操作のコード・要約・内容
 */
async function recordTeam(
  tx: TxDb,
  actor: TeamActor,
  accountIds: string[],
  input: { action: string; summary?: string | null; details?: Record<string, unknown> },
) {
  if (accountIds.length === 0) return;
  const owned = new Set(
    (
      await tx
        .select({ accountId: memberships.accountId })
        .from(memberships)
        .where(and(eq(memberships.userId, actor.id), eq(memberships.role, "owner"), inArray(memberships.accountId, accountIds)))
    ).map((r) => r.accountId),
  );
  for (const accountId of accountIds) {
    const role: ActorRole = owned.has(accountId) ? "owner" : actor.role;
    await insertActivity(tx, { accountId, actor: { id: actor.id, name: actor.name, role }, kind: "member", ...input });
  }
}

/**
 * 利用者の名前（記録の要約に使う）。
 * @param db - データベース
 * @param userId - users.id
 * @returns 名前（見つからなければ空）
 */
async function nameOf(db: Db | TxDb, userId: string): Promise<string> {
  const [u] = await db.select({ displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, userId));
  return u ? personName(u) : "";
}

/**
 * チームのアカウントのID。
 * @param db - データベース
 * @param teamId - teams.id
 * @param ownerUserId - 指定すれば、その人がオーナーのものだけ
 * @returns アカウントのID
 */
async function teamAccountIds(db: Db | TxDb, teamId: string, ownerUserId?: string): Promise<string[]> {
  const base = db.select({ accountId: teamAccounts.accountId }).from(teamAccounts);
  const rows = ownerUserId
    ? await base
        .innerJoin(
          memberships,
          and(eq(memberships.accountId, teamAccounts.accountId), eq(memberships.role, "owner"), eq(memberships.userId, ownerUserId)),
        )
        .where(eq(teamAccounts.teamId, teamId))
    : await base.where(eq(teamAccounts.teamId, teamId));
  return rows.map((r) => r.accountId);
}

// ---- /api/me ----

/**
 * 入っているチーム（参加した順。research.md R5）。サイドバーの「チーム」の見出しの下に並べる。
 * @param db - データベース
 * @param userId - ログインした人
 * @returns チームの一覧
 */
export async function listMyTeams(db: Db | TxDb, userId: string) {
  const all = alias(teamMembers, "all_m");
  const rows = await db
    .select({ id: teams.id, name: teams.name, role: teamMembers.role, memberCount: sql<number>`count(${all.userId})::int` })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .innerJoin(all, eq(all.teamId, teams.id))
    .where(eq(teamMembers.userId, userId))
    .groupBy(teams.id, teams.name, teamMembers.role, teamMembers.joinedAt)
    .orderBy(asc(teamMembers.joinedAt), asc(teams.id));
  return rows.map((r) => ({ id: r.id, name: r.name, memberCount: Number(r.memberCount), role: r.role }));
}

// ---- 作る・読む・名前・削除 ----

/**
 * チームを作る（FR-010）。作った人が管理者になり、選んだ自分のアカウントがチームに入る（初めは見せない）。
 * 利用者の行に鍵をかけて、管理者のチームの数（20まで）を数える。
 * @param env - Workers のバインディング
 * @param tx - トランザクション
 * @param user - ログインした人
 * @param input - 名前（前後の空白を除いたもの）と、入れるアカウント
 * @returns 作ったチームのID
 * @throws AppError TEAM_LIMIT_REACHED・TEAM_NEEDS_ACCOUNT・ACCOUNT_NOT_FOUND・ACCOUNT_IN_OTHER_TEAM
 */
export async function createTeam(env: Env, tx: TxDb, user: { id: string }, input: { name: string; accountIds: string[] }) {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
  await assertOwnFreeAccounts(tx, user.id, input.accountIds);
  // 管理者のチームの数のロックは、行ロックの後に取る（db/locks.ts の lockAdminTeams）
  await assertCanAdminMore(tx, user.id);
  const teamId = crypto.randomUUID();
  const sealed = await sealInviteToken(env, newInviteToken(), teamId);
  const now = new Date();
  await tx.insert(teams).values({
    id: teamId,
    name: input.name,
    adminUserId: user.id,
    inviteTokenHash: sealed.hash,
    inviteTokenCiphertext: sealed.ciphertext,
    inviteTokenIv: sealed.iv,
    inviteKeyVersion: sealed.keyVersion,
    createdAt: now,
    updatedAt: now,
  });
  await tx.insert(teamMembers).values({ teamId, userId: user.id, role: "admin", joinedAt: now });
  const ids = [...new Set(input.accountIds)];
  await tx.insert(teamAccounts).values(ids.map((accountId) => ({ teamId, accountId, addedByUserId: user.id, addedAt: now, updatedAt: now })));
  const name = await nameOf(tx, user.id);
  await recordTeam(tx, { id: user.id, name, role: "admin" }, ids, { action: "team_created", summary: input.name });
  return teamId;
}

/**
 * その人が、もう1つのチームの管理者になれるか（20チームまで）。引き継ぎと同じロックで数える。
 * @param tx - トランザクション
 * @param userId - 管理者になる人
 * @returns なれるなら true
 */
async function canAdminMore(tx: TxDb, userId: string): Promise<boolean> {
  await lockAdminTeams(tx, userId);
  const [owned] = await tx.select({ n: count() }).from(teams).where(eq(teams.adminUserId, userId));
  return Number(owned?.n ?? 0) < TEAMS_PER_ADMIN;
}

/**
 * その人が、もう1つのチームの管理者になれることを確かめる。
 * @param tx - トランザクション
 * @param userId - 管理者になる人
 * @throws AppError TEAM_LIMIT_REACHED（すでに20チームの管理者）
 */
async function assertCanAdminMore(tx: TxDb, userId: string) {
  if (!(await canAdminMore(tx, userId))) throw new AppError("TEAM_LIMIT_REACHED", 409, "team limit reached");
}

/**
 * チームの詳細（contracts/api.md「GET /api/teams/:teamId の応答」）。開けないアカウントは名前だけ。
 * @param db - データベース
 * @param teamAccess - authorizeTeamMember の結果
 * @returns チームの詳細
 */
export async function getTeamDetail(db: Db | TxDb, teamAccess: TeamAccess) {
  const teamId = teamAccess.team.id;
  const me = teamAccess.member.id;
  const members = await db
    .select({
      userId: teamMembers.userId,
      role: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
      dismissedAt: teamMembers.joinedNoticeDismissedAt,
      displayName: users.displayName,
      email: users.email,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(teamMembers.joinedAt), asc(teamMembers.userId));
  const ownerM = alias(memberships, "owner_m");
  const accountRows = await db
    .select({ account: accounts, shared: teamAccounts.shared, ownerUserId: ownerM.userId })
    .from(teamAccounts)
    .innerJoin(accounts, eq(accounts.id, teamAccounts.accountId))
    .innerJoin(ownerM, and(eq(ownerM.accountId, accounts.id), eq(ownerM.role, "owner")))
    .where(eq(teamAccounts.teamId, teamId))
    .orderBy(asc(teamAccounts.addedAt), asc(accounts.id));
  // 見ている人の担当（同じチーム経由の editor の行）
  const mine = new Set(
    (
      await db
        .select({ accountId: memberships.accountId })
        .from(memberships)
        .where(and(eq(memberships.userId, me), eq(memberships.role, "editor"), eq(memberships.teamId, teamId)))
    ).map((r) => r.accountId),
  );
  const isAdmin = teamAccess.member.role === "admin";
  const byOwner = new Map<string, typeof accountRows>();
  for (const r of accountRows) byOwner.set(r.ownerUserId, [...(byOwner.get(r.ownerUserId) ?? []), r]);
  const admin = members.find((m) => m.role === "admin");
  return {
    id: teamId,
    name: teamAccess.team.name,
    myRole: teamAccess.member.role,
    admin: { userId: admin?.userId ?? teamAccess.team.adminUserId, name: admin ? personName(admin) : "" },
    members: members.map((m) => ({
      userId: m.userId,
      name: personName(m),
      role: m.role,
      isMe: m.userId === me,
      joinedAt: m.joinedAt.toISOString(),
      joinedNotice: isAdmin && m.userId !== me && m.dismissedAt === null,
      accounts: (byOwner.get(m.userId) ?? []).map((r) => {
        const relation = r.ownerUserId === me ? "owner" : mine.has(r.account.id) ? "assigned" : r.shared ? "shared_viewer" : null;
        return {
          id: r.account.id,
          username: r.account.username,
          displayName: r.account.displayName,
          profilePictureUrl: relation ? r.account.profilePictureUrl : null,
          shared: r.shared,
          canOpen: relation !== null,
          relation,
        };
      }),
    })),
    limits: { members: TEAM_MEMBER_LIMIT, editors: TEAM_EDITOR_LIMIT },
  };
}

/**
 * チーム名を直す（FR-017）。チームのすべてのアカウントに記録する。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeamAdmin の結果（鍵をかけてある）
 * @param name - 新しい名前（前後の空白を除いたもの）
 */
export async function renameTeam(tx: TxDb, teamAccess: TeamAccess, name: string) {
  const before = teamAccess.team.name;
  if (before === name) return;
  await tx.update(teams).set({ name, updatedAt: new Date() }).where(eq(teams.id, teamAccess.team.id));
  await recordTeam(tx, teamAccess.member, await teamAccountIds(tx, teamAccess.team.id), {
    action: "team_renamed",
    summary: name,
    details: { from: before, to: name },
  });
}

/**
 * チームを削除する（FR-017）。チームの人・アカウント・担当は外れ、アカウントのデータと記録は残る。
 * 削除の前に、チームのすべてのアカウントに記録する。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeamAdmin の結果（鍵をかけてある）
 */
export async function deleteTeam(tx: TxDb, teamAccess: TeamAccess) {
  await recordTeam(tx, teamAccess.member, await teamAccountIds(tx, teamAccess.team.id), {
    action: "team_deleted",
    summary: teamAccess.team.name,
  });
  // team_members・team_accounts・担当（memberships.team_id）は ON DELETE CASCADE で消える
  await tx.delete(teams).where(eq(teams.id, teamAccess.team.id));
}

// ---- 招待 ----

/**
 * チームの招待リンク（管理者だけ）。
 * @param env - Workers のバインディング
 * @param team - チームの行
 * @returns URL と作り直した日時（作り直していなければ作った日時）
 */
export async function getTeamInvite(env: Env, team: TeamAccess["team"]) {
  const token = await openInviteToken(
    env,
    { ciphertext: team.inviteTokenCiphertext, iv: team.inviteTokenIv, keyVersion: team.inviteKeyVersion },
    team.id,
  );
  return { url: inviteUrl(env, token), rotatedAt: (team.inviteRotatedAt ?? team.createdAt).toISOString() };
}

/**
 * 招待リンクを作り直す（FR-016）。前のリンクはすぐ使えない。
 * @param env - Workers のバインディング
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeamAdmin の結果（鍵をかけてある）
 * @returns 新しい URL と日時
 */
export async function rotateTeamInvite(env: Env, tx: TxDb, teamAccess: TeamAccess) {
  const sealed = await sealInviteToken(env, newInviteToken(), teamAccess.team.id);
  const now = new Date();
  const [team] = await tx
    .update(teams)
    .set({
      inviteTokenHash: sealed.hash,
      inviteTokenCiphertext: sealed.ciphertext,
      inviteTokenIv: sealed.iv,
      inviteKeyVersion: sealed.keyVersion,
      inviteRotatedAt: now,
      updatedAt: now,
    })
    .where(eq(teams.id, teamAccess.team.id))
    .returning();
  return getTeamInvite(env, team!);
}

// ---- ロールと担当 ----

/**
 * チームの人を読む（なければ TEAM_NOT_FOUND）。
 * @param db - データベース
 * @param teamId - teams.id
 * @param userId - users.id
 * @returns ロールと名前
 */
async function memberOf(db: Db | TxDb, teamId: string, userId: string) {
  const [m] = await db
    .select({ role: teamMembers.role, displayName: users.displayName, email: users.email, joinedAt: teamMembers.joinedAt })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  if (!m) throw teamNotFound();
  return { id: userId, role: m.role, name: personName(m), joinedAt: m.joinedAt };
}

/**
 * 編集者の人数。
 * @param db - データベース
 * @param teamId - teams.id
 * @returns 人数
 */
async function editorCount(db: Db | TxDb, teamId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "editor")));
  return Number(row?.n ?? 0);
}

/**
 * その人の担当（同じチーム経由の editor の行）を消す。
 * @param tx - トランザクション
 * @param teamId - teams.id
 * @param userId - 担当の人
 * @returns 担当が外れたアカウント
 */
async function removeAssignmentsOf(tx: TxDb, teamId: string, userId: string): Promise<string[]> {
  const removed = await tx
    .delete(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.teamId, teamId), eq(memberships.role, "editor")))
    .returning({ accountId: memberships.accountId });
  return removed.map((r) => r.accountId);
}

/**
 * ロールを切り替える（FR-020・FR-021）。管理者は切り替えられない。編集者からメンバーにすると担当が消える。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeamAdmin の結果（鍵をかけてある）
 * @param userId - 切り替える人
 * @param role - 新しいロール
 * @throws AppError TEAM_NOT_FOUND（チームの人でない）、ROLE_FORBIDDEN（管理者）、TEAM_FULL（編集者10人）
 */
export async function changeRole(tx: TxDb, teamAccess: TeamAccess, userId: string, role: "member" | "editor") {
  const teamId = teamAccess.team.id;
  const target = await memberOf(tx, teamId, userId);
  if (target.role === "admin") throw new AppError("ROLE_FORBIDDEN", 403, "admin role cannot change");
  if (target.role === role) return;
  if (role === "editor" && (await editorCount(tx, teamId)) >= TEAM_EDITOR_LIMIT) {
    throw new AppError("TEAM_FULL", 409, "editor limit", undefined, ["editors"]);
  }
  await tx.update(teamMembers).set({ role }).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  const unassigned = role === "member" ? await removeAssignmentsOf(tx, teamId, userId) : [];
  const own = await teamAccountIds(tx, teamId, userId);
  await recordTeam(tx, teamAccess.member, own, {
    action: "team_role_changed",
    summary: target.name,
    details: { userName: target.name, from: target.role, to: role },
  });
  await recordTeam(tx, teamAccess.member, unassigned, { action: "assignment_removed", summary: target.name });
}

/**
 * 担当の表（contracts/api.md「GET /api/teams/:teamId/assignments」）。行は編集者と管理者、列はチームのアカウント。
 * @param db - データベース
 * @param teamAccess - authorizeTeamAdmin の結果
 * @returns 担当の表
 */
export async function getAssignments(db: Db | TxDb, teamAccess: TeamAccess) {
  const teamId = teamAccess.team.id;
  const ownerM = alias(memberships, "owner_m");
  const ownerU = alias(users, "owner_u");
  const cols = await db
    .select({ account: accounts, ownerUserId: ownerU.id, ownerDisplayName: ownerU.displayName, ownerEmail: ownerU.email })
    .from(teamAccounts)
    .innerJoin(accounts, eq(accounts.id, teamAccounts.accountId))
    .innerJoin(ownerM, and(eq(ownerM.accountId, accounts.id), eq(ownerM.role, "owner")))
    .innerJoin(ownerU, eq(ownerU.id, ownerM.userId))
    .where(eq(teamAccounts.teamId, teamId))
    .orderBy(asc(teamAccounts.addedAt), asc(accounts.id));
  const people = await db
    .select({ userId: teamMembers.userId, role: teamMembers.role, displayName: users.displayName, email: users.email })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), ne(teamMembers.role, "member")))
    .orderBy(sql`CASE WHEN ${teamMembers.role} = 'admin' THEN 0 ELSE 1 END`, asc(teamMembers.joinedAt));
  const rows = await db
    .select({ userId: memberships.userId, accountId: memberships.accountId })
    .from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.role, "editor")));
  const byPerson = new Map<string, string[]>();
  for (const r of rows) byPerson.set(r.userId, [...(byPerson.get(r.userId) ?? []), r.accountId]);
  return {
    accounts: cols.map((c) => ({
      id: c.account.id,
      username: c.account.username,
      displayName: c.account.displayName,
      profilePictureUrl: c.account.profilePictureUrl,
      ownerUserId: c.ownerUserId,
      ownerName: personName({ displayName: c.ownerDisplayName, email: c.ownerEmail }),
    })),
    people: people.map((p) => ({
      userId: p.userId,
      name: personName(p),
      role: p.role,
      isMe: p.userId === teamAccess.member.id,
      accountIds: byPerson.get(p.userId) ?? [],
    })),
  };
}

/**
 * 担当を付ける・外す（FR-022〜FR-024）。判定は access.ts の authorizeAssignment を通す。すでにその状態なら何もしない。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeamAdmin の結果（鍵をかけてある）
 * @param userId - 担当の人
 * @param accountId - アカウント
 * @param on - true なら担当にする、false なら外す
 * @returns 変えたなら true
 * @throws AppError TEAM_NOT_FOUND・ASSIGNMENT_NOT_ALLOWED
 */
export async function setAssignment(tx: TxDb, teamAccess: TeamAccess, userId: string, accountId: string, on: boolean) {
  const teamId = teamAccess.team.id;
  if (on) {
    await authorizeAssignment(tx, teamAccess, userId, accountId);
    // 同じ担当の追加が同時に届いても失敗しないよう、挿入そのものを冪等にする（PR #9 のCodexレビュー）
    const inserted = await tx
      .insert(memberships)
      .values({ userId, accountId, role: "editor", teamId })
      .onConflictDoNothing({ target: [memberships.userId, memberships.accountId] })
      .returning({ id: memberships.id });
    if (inserted.length === 0) return false;
    await recordTeam(tx, teamAccess.member, [accountId], { action: "assignment_added", summary: await nameOf(tx, userId) });
    return true;
  }
  await memberOf(tx, teamId, userId);
  const removed = await tx
    .delete(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.accountId, accountId),
        eq(memberships.role, "editor"),
        eq(memberships.teamId, teamId),
      ),
    )
    .returning({ id: memberships.id });
  if (removed.length === 0) return false;
  await recordTeam(tx, teamAccess.member, [accountId], { action: "assignment_removed", summary: await nameOf(tx, userId) });
  return true;
}

// ---- 見せる・入れる・外す ----

/**
 * チームのアカウントの行を読む（なければ TEAM_NOT_FOUND）。
 * @param db - データベース
 * @param teamId - teams.id
 * @param accountId - accounts.id
 * @returns 見せる設定とオーナー
 */
async function teamAccountOf(db: Db | TxDb, teamId: string, accountId: string) {
  const [row] = await db
    .select({ shared: teamAccounts.shared, ownerUserId: memberships.userId })
    .from(teamAccounts)
    .innerJoin(memberships, and(eq(memberships.accountId, teamAccounts.accountId), eq(memberships.role, "owner")))
    .where(and(eq(teamAccounts.teamId, teamId), eq(teamAccounts.accountId, accountId)))
    .limit(1);
  if (!row) throw teamNotFound();
  return row;
}

/**
 * 「チームに見せる」を切り替える（FR-030）。そのアカウントのオーナーだけ。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeamMember の結果（鍵をかけてある）
 * @param accountId - アカウント
 * @param shared - 見せるか
 * @throws AppError TEAM_NOT_FOUND（チームのアカウントでない）、ROLE_FORBIDDEN（オーナーでない）
 */
export async function setShared(tx: TxDb, teamAccess: TeamAccess, accountId: string, shared: boolean) {
  const row = await teamAccountOf(tx, teamAccess.team.id, accountId);
  if (row.ownerUserId !== teamAccess.member.id) throw new AppError("ROLE_FORBIDDEN", 403, "owner only");
  if (row.shared === shared) return;
  await tx
    .update(teamAccounts)
    .set({ shared, updatedAt: new Date() })
    .where(and(eq(teamAccounts.teamId, teamAccess.team.id), eq(teamAccounts.accountId, accountId)));
  await recordTeam(tx, teamAccess.member, [accountId], { action: "team_share_changed", details: { shared } });
}

/**
 * 自分のアカウントをチームに足す（FR-034）。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeamMember の結果（鍵をかけてある）
 * @param accountId - アカウント
 * @param shared - 見せるか（既定は見せない）
 * @throws AppError ACCOUNT_NOT_FOUND（自分のアカウントでない）、ACCOUNT_IN_OTHER_TEAM
 */
export async function addTeamAccount(tx: TxDb, teamAccess: TeamAccess, accountId: string, shared = false) {
  await assertOwnFreeAccounts(tx, teamAccess.member.id, [accountId]);
  const now = new Date();
  await tx
    .insert(teamAccounts)
    .values({ teamId: teamAccess.team.id, accountId, addedByUserId: teamAccess.member.id, shared, addedAt: now, updatedAt: now });
  await recordTeam(tx, teamAccess.member, [accountId], { action: "team_account_added", details: { shared } });
}

/**
 * アカウントをチームから外す（FR-034・FR-046）。そのアカウントのオーナーか管理者。最後の1つは外せない。
 * そのアカウントでのほかの人の担当も消す。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeamMember の結果（鍵をかけてある）
 * @param accountId - アカウント
 * @throws AppError TEAM_NOT_FOUND・ROLE_FORBIDDEN・TEAM_LAST_ACCOUNT
 */
export async function removeTeamAccount(tx: TxDb, teamAccess: TeamAccess, accountId: string) {
  const teamId = teamAccess.team.id;
  const row = await teamAccountOf(tx, teamId, accountId);
  if (row.ownerUserId !== teamAccess.member.id && teamAccess.member.role !== "admin") {
    throw new AppError("ROLE_FORBIDDEN", 403, "owner or admin only");
  }
  if ((await teamAccountIds(tx, teamId, row.ownerUserId)).length <= 1) {
    throw new AppError("TEAM_LAST_ACCOUNT", 409, "last account");
  }
  await recordTeam(tx, teamAccess.member, [accountId], { action: "team_account_removed" });
  await detachAccount(tx, teamId, accountId);
}

/**
 * アカウントをチームから外す（担当を消してから、team_accounts の行を消す）。
 * @param tx - トランザクション
 * @param teamId - teams.id
 * @param accountId - accounts.id
 */
async function detachAccount(tx: TxDb, teamId: string, accountId: string) {
  await tx
    .delete(memberships)
    .where(and(eq(memberships.accountId, accountId), eq(memberships.teamId, teamId), eq(memberships.role, "editor")));
  await tx.delete(teamAccounts).where(and(eq(teamAccounts.teamId, teamId), eq(teamAccounts.accountId, accountId)));
}

// ---- 抜ける・外す・引き継ぐ ----

/**
 * その人をチームから外す（research.md R7）。その人のアカウント・その人の担当・その人のアカウントでのほかの人の担当を消す。
 * 記録は外す前に、その人のアカウントに書く。
 * @param tx - トランザクション
 * @param teamId - teams.id
 * @param userId - 外す人
 * @param actor - した人
 * @param action - 記録のコード
 */
async function detachMember(tx: TxDb, teamId: string, userId: string, actor: TeamActor, action: string) {
  const own = await teamAccountIds(tx, teamId, userId);
  await recordTeam(tx, actor, own, { action, summary: await nameOf(tx, userId) });
  await removeAssignmentsOf(tx, teamId, userId);
  for (const accountId of own) await detachAccount(tx, teamId, accountId);
  await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
}

/**
 * 管理者を引き継ぐ（FR-044・FR-045）。前の管理者は、担当が1件以上あれば編集者、なければメンバーになる（担当はそのまま）。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeamAdmin の結果（鍵をかけてある）
 * @param newAdminUserId - 新しい管理者（チームの人）
 * @param opts - leaving：引き継いだ後にそのまま抜ける（編集者の上限を数えない）
 * @throws AppError TEAM_NOT_FOUND（チームの人でない）、VALIDATION_FAILED（自分）、TEAM_FULL（編集者が上限を超える）、
 *   TEAM_LIMIT_REACHED（引き継ぐ人がすでに20チームの管理者）
 */
export async function transferAdmin(
  tx: TxDb,
  teamAccess: TeamAccess,
  newAdminUserId: string,
  opts: { leaving?: boolean } = {},
) {
  const teamId = teamAccess.team.id;
  const from = teamAccess.member;
  if (newAdminUserId === from.id) throw new AppError("VALIDATION_FAILED", 400, "already admin", undefined, ["userId"]);
  const to = await memberOf(tx, teamId, newAdminUserId);
  const [assigned] = await tx
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.userId, from.id), eq(memberships.teamId, teamId), eq(memberships.role, "editor")));
  const fromRole: TeamRole = Number(assigned?.n ?? 0) > 0 ? "editor" : "member";
  // 前の管理者が編集者になるときも、編集者は10人まで（changeRole と同じ上限。PR #14 のCodexレビュー）。
  // 引き継いでそのまま抜けるとき（抜ける・最後のアカウントの削除）は、編集者として残らないので数えない
  if (!opts.leaving && fromRole === "editor") {
    const after = (await editorCount(tx, teamId)) - (to.role === "editor" ? 1 : 0) + 1;
    if (after > TEAM_EDITOR_LIMIT) throw new AppError("TEAM_FULL", 409, "editor limit", undefined, ["editors"]);
  }
  // 引き継ぐ人が管理者のチームも20まで（createTeam と同じ上限。PR #14 のCodexレビュー）
  await assertCanAdminMore(tx, to.id);
  // 部分一意索引（管理者は1人）を守るため、前の管理者を先に変える
  await tx.update(teamMembers).set({ role: fromRole }).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, from.id)));
  await tx.update(teamMembers).set({ role: "admin" }).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, to.id)));
  await tx.update(teams).set({ adminUserId: to.id, updatedAt: new Date() }).where(eq(teams.id, teamId));
  await recordTeam(tx, from, await teamAccountIds(tx, teamId), {
    action: "team_admin_transferred",
    summary: to.name,
    details: { from: from.name, to: to.name },
  });
}

/**
 * チームを抜ける（FR-040・FR-042）。管理者は、引き継ぐ人を選んで、同じトランザクションで引き継いでから抜ける。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeamMember の結果（鍵をかけてある）
 * @param newAdminUserId - 管理者が抜けるときの引き継ぎ先
 * @throws AppError TEAM_ADMIN_ALONE（ほかに誰もいない）、TEAM_ADMIN_MUST_TRANSFER（引き継ぎ先がない）
 */
export async function leaveTeam(tx: TxDb, teamAccess: TeamAccess, newAdminUserId: string | undefined) {
  const teamId = teamAccess.team.id;
  if (teamAccess.member.role === "admin") {
    const [others] = await tx
      .select({ n: count() })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), ne(teamMembers.userId, teamAccess.member.id)));
    if (Number(others?.n ?? 0) === 0) throw new AppError("TEAM_ADMIN_ALONE", 409, "admin alone");
    if (!newAdminUserId) throw new AppError("TEAM_ADMIN_MUST_TRANSFER", 409, "admin must transfer");
    await transferAdmin(tx, teamAccess, newAdminUserId, { leaving: true });
  }
  const [me] = await tx
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, teamAccess.member.id)));
  await detachMember(tx, teamId, teamAccess.member.id, { ...teamAccess.member, role: me?.role ?? "member" }, "team_member_left");
}

/**
 * 管理者が人をチームから外す（FR-041）。自分は外せない（抜けるを使う）。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeamAdmin の結果（鍵をかけてある）
 * @param userId - 外す人
 * @throws AppError TEAM_NOT_FOUND（チームの人でない）、VALIDATION_FAILED（自分）
 */
export async function removeMember(tx: TxDb, teamAccess: TeamAccess, userId: string) {
  if (userId === teamAccess.member.id) throw new AppError("VALIDATION_FAILED", 400, "cannot remove self", undefined, ["userId"]);
  await memberOf(tx, teamAccess.team.id, userId);
  await detachMember(tx, teamAccess.team.id, userId, teamAccess.member, "team_member_removed");
}

/**
 * アカウントを削除する前に呼ぶ（FR-046、research.md R7）。オーナーのチームのアカウントがこれで0件になるなら、
 * オーナーはチームを抜けたものとする。管理者なら、いちばん長くいる人へ引き継ぎ、誰もいなければチームを消す。
 * @param tx - アカウントの削除と同じトランザクション
 * @param accountId - 削除するアカウント
 * @param ownerUserId - そのアカウントのオーナー
 */
export async function beforeAccountDeleted(tx: TxDb, accountId: string, ownerUserId: string) {
  const [row] = await tx.select({ teamId: teamAccounts.teamId }).from(teamAccounts).where(eq(teamAccounts.accountId, accountId));
  if (!row) return;
  const teamId = row.teamId;
  // 抜ける・引き継ぐと同じく、チームの行に鍵をかけてから数える
  await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for("update");
  // 鍵を待つ間に、このアカウントがチームから外れたかもしれないので読み直す（外れていれば、ほかのアカウントを
  // 最後の1件と取り違えてオーナーを抜けさせない。PR #14 のCodexレビュー）
  const [still] = await tx
    .select({ teamId: teamAccounts.teamId })
    .from(teamAccounts)
    .where(and(eq(teamAccounts.teamId, teamId), eq(teamAccounts.accountId, accountId)));
  if (!still) return;
  if ((await teamAccountIds(tx, teamId, ownerUserId)).length > 1) {
    // ほかにもアカウントがあれば、このアカウントだけが外れる（担当は ON DELETE CASCADE で消える）
    return;
  }
  const me = await memberOf(tx, teamId, ownerUserId);
  if (me.role === "admin") {
    // いちばん長くいる人へ引き継ぐ。ただし、すでに20チームの管理者の人は飛ばす（PR #14 のCodexレビュー）
    const others = await tx
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), ne(teamMembers.userId, ownerUserId)))
      .orderBy(asc(teamMembers.joinedAt), asc(teamMembers.userId));
    let next: { userId: string } | undefined;
    for (const o of others) {
      if (await canAdminMore(tx, o.userId)) {
        next = o;
        break;
      }
    }
    // 引き継げる人がいなければ、チームを消す（管理者のいないチームを残さない）
    if (!next) {
      await tx.delete(teams).where(eq(teams.id, teamId));
      return;
    }
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId));
    await transferAdmin(tx, { team: team!, member: { id: me.id, name: me.name, role: "admin" } }, next.userId, { leaving: true });
  }
  const [now] = await tx
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, ownerUserId)));
  await detachMember(tx, teamId, ownerUserId, { id: me.id, name: me.name, role: now?.role ?? "member" }, "team_member_left");
}

// ---- 知らせ ----

/**
 * 管理者が、ある人の参加の知らせを閉じる（FR-062、research.md R9）。
 * @param db - データベース
 * @param teamId - teams.id
 * @param userId - 参加した人
 * @throws AppError TEAM_NOT_FOUND（チームの人でない）
 */
export async function dismissJoinedNotice(db: Db, teamId: string, userId: string) {
  const updated = await db
    .update(teamMembers)
    .set({ joinedNoticeDismissedAt: new Date() })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .returning({ userId: teamMembers.userId });
  if (updated.length === 0) throw teamNotFound();
}

/**
 * 担当の人が、担当の知らせを閉じる（FR-062、research.md R9）。
 * @param db - データベース
 * @param access - 担当の人の判定の結果
 */
export async function dismissAssignedNotice(db: Db | TxDb, access: AccountAccess) {
  await db
    .update(memberships)
    .set({ assignedNoticeDismissedAt: new Date() })
    .where(and(eq(memberships.accountId, access.account.id), eq(memberships.userId, access.actor.id), eq(memberships.role, "editor")));
}

/**
 * 担当の知らせを出すか（担当の人で、まだ閉じていない）。
 * @param db - データベース
 * @param access - 判定の結果
 * @returns 出すなら true
 */
export async function assignedNoticeVisible(db: Db | TxDb, access: AccountAccess): Promise<boolean> {
  if (access.relation !== "assigned") return false;
  const [row] = await db
    .select({ dismissedAt: memberships.assignedNoticeDismissedAt })
    .from(memberships)
    .where(and(eq(memberships.accountId, access.account.id), eq(memberships.userId, access.actor.id), eq(memberships.role, "editor")))
    .limit(1);
  return Boolean(row) && row!.dismissedAt === null;
}

// ---- このアカウントのチーム（009のカード）----

/**
 * このアカウントのチーム（contracts/api.md「GET /api/accounts/:accountId/team」、FR-055）。
 * @param db - データベース
 * @param access - 判定の結果（read で読める）
 * @returns チーム・オーナー・担当の人
 */
export async function getAccountTeam(db: Db | TxDb, access: AccountAccess) {
  const accountId = access.account.id;
  let team: { id: string; name: string; admin: { userId: string; name: string }; shared: boolean } | null = null;
  let assignees: { userId: string; name: string; role: TeamRole }[] = [];
  if (access.team) {
    const adminU = alias(users, "admin_u");
    const [row] = await db
      .select({ adminUserId: adminU.id, displayName: adminU.displayName, email: adminU.email, shared: teamAccounts.shared })
      .from(teamAccounts)
      .innerJoin(teams, eq(teams.id, teamAccounts.teamId))
      .innerJoin(adminU, eq(adminU.id, teams.adminUserId))
      .where(eq(teamAccounts.accountId, accountId))
      .limit(1);
    if (row) {
      team = {
        id: access.team.id,
        name: access.team.name,
        admin: { userId: row.adminUserId, name: personName(row) },
        shared: row.shared,
      };
      const rows = await db
        .select({ userId: users.id, displayName: users.displayName, email: users.email, role: teamMembers.role })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(teamMembers, and(eq(teamMembers.teamId, access.team.id), eq(teamMembers.userId, memberships.userId)))
        .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "editor"), eq(memberships.teamId, access.team.id)))
        .orderBy(asc(memberships.createdAt));
      assignees = rows.map((r) => ({ userId: r.userId, name: personName(r), role: r.role }));
    }
  }
  return {
    team,
    owner: { userId: access.owner.id, name: access.owner.name },
    viewerUserId: access.actor.id,
    assignees,
  };
}
