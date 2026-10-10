// チーム・編集者・担当・手伝いの関係（specs/008-team-operations data-model.md、research.md R1）。
// memberships の partner・editor の行は、このファイルと invite-service.ts 以外から書かない（plan.md「構成の判断」）。
// 権限の判定は access.ts を通す（contracts/permissions.md「チームの判定」）。
import { and, asc, count, eq, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, TxDb } from "../db/client";
import { accountPartners, memberships, teamEditors, teams, users } from "../db/schema";
import { TEAM_EDITOR_LIMIT } from "@threads-grower/shared";
import { AppError } from "../lib/errors";
import { insertActivity, updatedByOf } from "./activity-log";
import {
  authorizeAssignment,
  listTeamAccounts,
  personName,
  teamNotFound,
  type AccountAccess,
  type TeamAccess,
} from "./access";

/**
 * /api/me に出す、チームのパートナー・待機中の編集者の情報（research.md R11、FR-026・FR-047）。
 * @param db - データベース
 * @param userId - ログインした人
 * @param hasAccounts - 開けるAccountが1件以上あるか（あれば待機の案内は出さない）
 * @returns partnerTeam と editorWaiting
 */
export async function getMeTeamInfo(db: Db | TxDb, userId: string, hasAccounts: boolean) {
  const editorM = alias(memberships, "editor_m");
  const [team] = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.partnerUserId, userId))
    .limit(1);
  let partnerTeam: { name: string | null; unassignedEditorCount: number } | null = null;
  if (team) {
    const [row] = await db
      .select({ n: count() })
      .from(teamEditors)
      .where(
        and(
          eq(teamEditors.teamId, team.id),
          notExists(
            db
              .select({ one: sql`1` })
              .from(editorM)
              .where(and(eq(editorM.userId, teamEditors.userId), eq(editorM.teamId, team.id), eq(editorM.role, "editor"))),
          ),
        ),
      );
    partnerTeam = { name: team.name, unassignedEditorCount: Number(row?.n ?? 0) };
  }
  let editorWaiting: { partnerName: string } | null = null;
  if (!hasAccounts) {
    const [waiting] = await db
      .select({ displayName: users.displayName, email: users.email })
      .from(teamEditors)
      .innerJoin(teams, eq(teams.id, teamEditors.teamId))
      .innerJoin(users, eq(users.id, teams.partnerUserId))
      .where(
        and(
          eq(teamEditors.userId, userId),
          notExists(
            db
              .select({ one: sql`1` })
              .from(editorM)
              .where(and(eq(editorM.userId, userId), eq(editorM.teamId, teamEditors.teamId))),
          ),
        ),
      )
      .orderBy(asc(teamEditors.joinedAt))
      .limit(1);
    if (waiting) editorWaiting = { partnerName: personName(waiting) };
  }
  return { partnerTeam, editorWaiting };
}

/**
 * このAccountを手伝っている人（contracts/api.md「GET /api/accounts/:id/team」、FR-042・FR-047(1)）。
 * @param db - データベース
 * @param access - 判定の結果（全役割で読める）
 * @returns パートナー・任せる範囲・担当の編集者・参加の知らせ
 */
export async function getAccountTeam(db: Db | TxDb, access: AccountAccess) {
  const accountId = access.account.id;
  const partnerU = alias(users, "partner_u");
  const [partner] = access.team
    ? await db
        .select({
          userId: partnerU.id,
          displayName: partnerU.displayName,
          email: partnerU.email,
          teamName: teams.name,
          joinedAt: accountPartners.joinedAt,
          dismissedAt: accountPartners.joinedNoticeDismissedAt,
        })
        .from(accountPartners)
        .innerJoin(teams, eq(teams.id, accountPartners.teamId))
        .innerJoin(partnerU, eq(partnerU.id, teams.partnerUserId))
        .where(eq(accountPartners.accountId, accountId))
        .limit(1)
    : [];
  const editors = await db
    .select({ userId: users.id, displayName: users.displayName, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "editor")))
    .orderBy(asc(memberships.createdAt));
  return {
    partner: partner
      ? {
          userId: partner.userId,
          name: personName(partner),
          teamName: partner.teamName,
          joinedAt: partner.joinedAt.toISOString(),
        }
      : null,
    delegation: access.delegation,
    editors: editors.map((e) => ({ userId: e.userId, name: personName(e) })),
    joinedNotice: { show: access.role === "owner" && Boolean(partner) && partner!.dismissedAt === null },
  };
}

/**
 * オーナーがパートナーを外す（FR-033・spec US1-8）。手伝いの関係と、そのチーム経由の partner・editor の行を消す。
 * 任せる範囲は手伝いの関係と一緒に消える。
 * @param tx - トランザクション
 * @param accountId - accounts.id
 * @returns 外したパートナーと、担当が外れた編集者（記録に使う）。パートナーがいなければNULL
 */
export async function removePartner(tx: TxDb, accountId: string) {
  // 担当の追加・編集者を外す操作と同じく、チームの行 → 手伝いの関係の行の順で鍵をかける（PR #9 のCodexレビュー）
  const [found] = await tx
    .select({ teamId: accountPartners.teamId })
    .from(accountPartners)
    .where(eq(accountPartners.accountId, accountId))
    .limit(1);
  if (!found) return null;
  await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, found.teamId)).for("update");
  const [rel] = await tx
    .select({ teamId: accountPartners.teamId })
    .from(accountPartners)
    .where(and(eq(accountPartners.accountId, accountId), eq(accountPartners.teamId, found.teamId)))
    .for("update");
  if (!rel) return null;
  const removed = await tx
    .delete(memberships)
    .where(and(eq(memberships.accountId, accountId), eq(memberships.teamId, rel.teamId)))
    .returning({ userId: memberships.userId, role: memberships.role });
  await tx.delete(accountPartners).where(eq(accountPartners.accountId, accountId));
  return { teamId: rel.teamId, removed };
}

/**
 * パートナーの参加の知らせを閉じる（FR-047(1)）。
 * @param db - データベース
 * @param accountId - accounts.id
 */
export async function dismissJoinedNotice(db: Db | TxDb, accountId: string) {
  await db
    .update(accountPartners)
    .set({ joinedNoticeDismissedAt: new Date(), updatedAt: new Date() })
    .where(eq(accountPartners.accountId, accountId));
}

/**
 * パートナーのチーム（contracts/api.md「GET /api/team」）。Accountの一覧は listTeamAccounts から作る。
 * @param db - データベース
 * @param teamAccess - authorizeTeam の結果
 * @returns チーム・編集者（担当つき）・関われるAccount・担当未定の人数
 */
export async function getTeam(db: Db | TxDb, teamAccess: TeamAccess) {
  const teamId = teamAccess.team.id;
  const accountsList = await listTeamAccounts(db, teamAccess);
  const editorRows = await db
    .select({ userId: users.id, displayName: users.displayName, email: users.email, joinedAt: teamEditors.joinedAt })
    .from(teamEditors)
    .innerJoin(users, eq(users.id, teamEditors.userId))
    .where(eq(teamEditors.teamId, teamId))
    .orderBy(asc(teamEditors.joinedAt));
  const assignments = await db
    .select({ userId: memberships.userId, accountId: memberships.accountId })
    .from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.role, "editor")));
  const byEditor = new Map<string, string[]>();
  for (const a of assignments) byEditor.set(a.userId, [...(byEditor.get(a.userId) ?? []), a.accountId]);
  const editors = editorRows.map((e) => ({
    userId: e.userId,
    name: personName(e),
    joinedAt: e.joinedAt.toISOString(),
    accountIds: byEditor.get(e.userId) ?? [],
  }));
  return {
    id: teamId,
    name: teamAccess.team.name,
    partnerName: teamAccess.partner.name,
    editorLimit: TEAM_EDITOR_LIMIT,
    editors,
    accounts: accountsList.map((a) => ({
      id: a.account.id,
      displayName: a.account.displayName,
      username: a.account.username,
      profilePictureUrl: a.account.profilePictureUrl,
      ownerName: a.owner.name,
      own: a.own,
    })),
    unassignedEditorCount: editors.filter((e) => e.accountIds.length === 0).length,
  };
}

/**
 * チーム名を直す（FR-062）。
 * @param db - データベース
 * @param teamId - teams.id
 * @param name - チーム名（空ならNULL）
 */
export async function renameTeam(db: Db | TxDb, teamId: string, name: string) {
  const trimmed = name.trim();
  await db.update(teams).set({ name: trimmed || null, updatedAt: new Date() }).where(eq(teams.id, teamId));
}

/**
 * 編集者をAccountの担当にする（FR-023）。判定は access.ts の authorizeAssignment を通す。すでに担当なら何もしない。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeam の結果
 * @param editorUserId - 編集者
 * @param accountId - Account
 * @returns 担当にしたなら true（すでに担当なら false）
 * @throws AppError TEAM_NOT_FOUND・ASSIGNMENT_NOT_ALLOWED
 */
export async function assignEditor(tx: TxDb, teamAccess: TeamAccess, editorUserId: string, accountId: string) {
  // 呼び出し側でチームの行に鍵をかけてある（authorizeTeam の lock）。編集者を外す・パートナーを外す操作も
  // 同じ行に鍵をかけるので、外した後に担当が残ることはない（PR #9 のCodexレビュー）
  const target = await authorizeAssignment(tx, teamAccess, editorUserId, accountId);
  // 同じ担当の追加が同時に届いても失敗しないよう、挿入そのものを冪等にする（PR #9 のCodexレビュー）
  const inserted = await tx
    .insert(memberships)
    .values({ userId: editorUserId, accountId, role: "editor", teamId: teamAccess.team.id })
    .onConflictDoNothing({ target: [memberships.userId, memberships.accountId] })
    .returning();
  if (inserted.length === 0) {
    const [existing] = await tx
      .select({ role: memberships.role, teamId: memberships.teamId })
      .from(memberships)
      .where(and(eq(memberships.userId, editorUserId), eq(memberships.accountId, accountId)))
      .limit(1);
    if (existing?.role === "editor" && existing.teamId === teamAccess.team.id) return false;
    // 同じAccountで別の役割を持っている人は担当にできない（spec Edge Cases）
    throw new AppError("ASSIGNMENT_NOT_ALLOWED", 409, "already has another role");
  }
  await recordTeamActivity(tx, teamAccess, target.own, accountId, "assignment_added", editorUserId);
  return true;
}

/**
 * 編集者の担当を外す。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeam の結果
 * @param editorUserId - 編集者
 * @param accountId - Account
 * @returns 外したなら true
 * @throws AppError TEAM_NOT_FOUND（チームの編集者ではない）
 */
export async function unassignEditor(tx: TxDb, teamAccess: TeamAccess, editorUserId: string, accountId: string) {
  // チームの編集者でなければ見つからない扱い（別のチームのパートナーからは操作できない）
  const [member] = await tx
    .select({ userId: teamEditors.userId })
    .from(teamEditors)
    .where(and(eq(teamEditors.teamId, teamAccess.team.id), eq(teamEditors.userId, editorUserId)))
    .limit(1);
  if (!member) throw teamNotFound();
  const removed = await tx
    .delete(memberships)
    .where(
      and(
        eq(memberships.userId, editorUserId),
        eq(memberships.accountId, accountId),
        eq(memberships.role, "editor"),
        eq(memberships.teamId, teamAccess.team.id),
      ),
    )
    .returning();
  if (removed.length > 0) {
    const own = (await listTeamAccounts(tx, teamAccess)).find((a) => a.account.id === accountId)?.own ?? false;
    await recordTeamActivity(tx, teamAccess, own, accountId, "assignment_removed", editorUserId);
  }
  return removed.length > 0;
}

/**
 * 編集者をチームから外す（FR-024）。担当（そのチーム経由の editor の行）もすべて消す。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeam の結果
 * @param editorUserId - 編集者
 * @returns 担当だったAccountのID
 * @throws AppError TEAM_NOT_FOUND（チームの編集者ではない）
 */
export async function removeEditor(tx: TxDb, teamAccess: TeamAccess, editorUserId: string) {
  const removedMember = await tx
    .delete(teamEditors)
    .where(and(eq(teamEditors.teamId, teamAccess.team.id), eq(teamEditors.userId, editorUserId)))
    .returning();
  if (removedMember.length === 0) throw teamNotFound();
  const removed = await tx
    .delete(memberships)
    .where(
      and(eq(memberships.userId, editorUserId), eq(memberships.teamId, teamAccess.team.id), eq(memberships.role, "editor")),
    )
    .returning();
  if (removed.length > 0) {
    const ownIds = new Set((await listTeamAccounts(tx, teamAccess)).filter((a) => a.own).map((a) => a.account.id));
    for (const r of removed) {
      await recordTeamActivity(tx, teamAccess, ownIds.has(r.accountId), r.accountId, "editor_removed", editorUserId);
    }
  }
  return removed.map((r) => r.accountId);
}

/**
 * パートナーに任せる範囲を変える（FR-030）。片方だけ渡せば、もう片方は変えない。
 * @param tx - トランザクション
 * @param accountId - accounts.id
 * @param delegation - 変える値
 * @returns 変える前と後の任せる範囲。パートナーがいなければNULL
 */
export async function setDelegation(tx: TxDb, accountId: string, delegation: { review?: boolean; settings?: boolean }) {
  const [before] = await tx
    .select({ review: accountPartners.delegateReview, settings: accountPartners.delegateSettings })
    .from(accountPartners)
    .where(eq(accountPartners.accountId, accountId))
    .for("update");
  if (!before) return null;
  const after = { review: delegation.review ?? before.review, settings: delegation.settings ?? before.settings };
  await tx
    .update(accountPartners)
    .set({ delegateReview: after.review, delegateSettings: after.settings, updatedAt: new Date() })
    .where(eq(accountPartners.accountId, accountId));
  return { before, after };
}

/**
 * パートナーのチームの操作（担当の付け外し・編集者を外す）を、そのAccountに記録する（FR-050）。
 * 担当の付け外しはチームがあるAccountでしか起きないので、必ず書く。
 * @param tx - トランザクション
 * @param teamAccess - authorizeTeam の結果
 * @param own - パートナー自身のAccountか（そのAccountでの役割はオーナー）
 * @param accountId - Account
 * @param action - 操作のコード
 * @param editorUserId - 対象の編集者
 */
async function recordTeamActivity(
  tx: TxDb,
  teamAccess: TeamAccess,
  own: boolean,
  accountId: string,
  action: "assignment_added" | "assignment_removed" | "editor_removed",
  editorUserId: string,
) {
  const editor = await updatedByOf(tx, editorUserId);
  await insertActivity(tx, {
    accountId,
    actor: { id: teamAccess.partner.id, name: teamAccess.partner.name, role: own ? "owner" : "partner" },
    kind: "member",
    action,
    summary: editor?.name ?? null,
  });
}
