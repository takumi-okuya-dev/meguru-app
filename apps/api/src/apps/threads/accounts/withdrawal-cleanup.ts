// 退会したときの、Threadsの片づけ（specs/013-billing research.md R10、specs/011 FR-046、specs/024 research.md R15）。
// 029 で共通の退会の処理から移した（specs/meguru/029-threads-pattern1 research.md R8）。出来事（user.withdrawn）の受け取りから、
// Threadsのトランザクションの中で呼ぶ（events/received-events.ts）。共通は、この片づけが届いたあとで users の行を消す。
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { TxDb } from "../../../kernel/db/client";
import { lockThreadsUser } from "../../../kernel/db/locks";
import { WITHDRAWN_ACTOR_NAME } from "../../../platform";
import { accounts, activityLogs, memberships, teamMembers, teams, threadsDeletionRequests, threadsUserStates } from "../schema";
import { beforeAccountDeleted, chooseSuccessor } from "../teams/team-service";
import { purgeForWithdrawal } from "../tester-invites/tester-application-service";
import { lockThreadsMember } from "../access/locks";

/**
 * 退会する人のThreadsのデータを片づける。持ち主のアカウントを消し（アカウントの削除と同じ。001 FR-022）、チームは抜ける
 * （管理者なら引き継ぐか、チームを消す。011 FR-046）。ほかの人のアカウントの記録の名前は「退会した人」にする。
 * @param tx - トランザクション
 * @param userId - 退会する人の users.id
 * @param now - 今の時刻
 */
export async function cleanupForWithdrawal(tx: TxDb, userId: string, now: Date = new Date()): Promise<void> {
  // ロックは、ほかの処理と同じ順番「Threadsユーザー → 利用者」で取る（specs/010 research.md R6）。Metaのデータ削除は
  // Threadsユーザーのロック → 削除の求めの行 → 利用者のロックの順なので、先に利用者のロックを取ると互いに待ち合う（PR #97 のCodexレビュー）
  const threadsUsers = await tx
    .selectDistinct({ threadsUserId: accounts.threadsUserId })
    .from(accounts)
    .innerJoin(memberships, and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")))
    .where(eq(memberships.userId, userId));
  for (const t of threadsUsers.flatMap((r) => (r.threadsUserId ? [r.threadsUserId] : [])).sort()) await lockThreadsUser(tx, t);
  // その人のアカウントの作成・削除・接続の確定・最後に開いたアカウントの記録と直列にする（PR #97 のセルフレビュー）
  await lockThreadsMember(tx, userId);
  // 招待の申し込みを片づける（枠を使っていない行は消し、使っている行はユーザー名だけを残す。specs/024 research.md R15）
  await purgeForWithdrawal(tx, userId);
  const owned = await tx
    .select({ id: accounts.id, threadsUserId: accounts.threadsUserId })
    .from(accounts)
    .innerJoin(memberships, and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(accounts.id));
  for (const a of owned) {
    // チームから外す（テスター招待は上で片づけ済み）
    await beforeAccountDeleted(tx, a.id, userId);
    await tx.delete(accounts).where(eq(accounts.id, a.id));
  }
  // Threads側からのデータ削除の求めが処理中なら、退会で消したので完了にする（spec Edge Cases）
  const threadsIds = owned.flatMap((a) => (a.threadsUserId ? [a.threadsUserId] : []));
  if (threadsIds.length > 0) {
    await tx
      .update(threadsDeletionRequests)
      .set({ status: "completed", completedAt: now, threadsUserId: null })
      .where(and(inArray(threadsDeletionRequests.threadsUserId, threadsIds), inArray(threadsDeletionRequests.status, ["pending", "failed"])));
  }
  // まだ管理者のチームがあれば引き継ぐ（teams.admin_user_id は ON DELETE RESTRICT）
  const adminOf = await tx.select({ id: teams.id }).from(teams).where(eq(teams.adminUserId, userId)).for("update");
  for (const t of adminOf) {
    const next = await chooseSuccessor(tx, t.id, userId, { lock: true });
    if (!next) {
      await tx.delete(teams).where(eq(teams.id, t.id));
      continue;
    }
    await tx.update(teamMembers).set({ role: "member" }).where(and(eq(teamMembers.teamId, t.id), eq(teamMembers.userId, userId)));
    await tx.update(teamMembers).set({ role: "admin" }).where(and(eq(teamMembers.teamId, t.id), eq(teamMembers.userId, next.userId)));
    await tx.update(teams).set({ adminUserId: next.userId, updatedAt: now }).where(eq(teams.id, t.id));
  }
  // ほかの人のアカウントの担当と、チームの人から外す（今は users の行を消すと外部キーで消えるが、PR3 で外部キーを外すので自分で外す）
  await tx.delete(memberships).where(and(eq(memberships.userId, userId), ne(memberships.role, "owner")));
  await tx.delete(teamMembers).where(eq(teamMembers.userId, userId));
  // 利用者ごとの状態（最後に開いたアカウント。specs/meguru/029 tasks.md T071）
  await tx.delete(threadsUserStates).where(eq(threadsUserStates.userId, userId));
  // ほかの人のアカウントの操作の記録は残し、名前を「退会した人」にする（FR-053）
  await tx.update(activityLogs).set({ actorName: WITHDRAWN_ACTOR_NAME }).where(eq(activityLogs.actorUserId, userId));
}
