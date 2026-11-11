// チームの運用状況（specs/020-team-monitoring data-model.md、research.md R1〜R8）。
// 新しい記録は取らず、開いたときに今ある表（操作の記録・下書き・反応数）から数える。読むだけで、書き込みも記録もしない。
// 見る範囲は access.ts の authorizeTeamStatus が決め、ここでは範囲の外の行を問い合わせの条件で除く（画面で隠さない。FR-002a）。
import {
  ACTIVITY_LOG_RETENTION_DAYS,
  TEAM_STATUS_ACTIVITY_ACTIONS,
  TEAM_STATUS_GROWTH_MIN_POSTS,
  TEAM_STATUS_GROWTH_POOR_RATIO,
  TEAM_STATUS_GROWTH_WINDOW_DAYS,
  TEAM_STATUS_STOPPED_DAYS,
  type TeamStatus,
  type TeamStatusGrowth,
} from "@meguru/shared";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db, TxDb } from "../../kernel/db/client";
import { accounts, memberships, teamAccounts, teamMembers, users } from "../schema";
import { personName, type TeamAccess, type TeamStatusScope } from "../access/access";
import { featureOnSql } from "../features/feature-sql";

const DAY_MS = 24 * 60 * 60 * 1000;

type Person = TeamStatus["people"][number];
type AccountStatus = TeamStatus["accounts"][number];

/**
 * 範囲のAccountに限る条件（管理者はチームに入っているすべて、編集者は担当のAccount）。
 * @param col - accounts.id にあたる列
 * @param teamId - teams.id
 * @param scope - 範囲
 * @returns 条件の式
 */
function inScope(col: AnyPgColumn | SQL, teamId: string, scope: TeamStatusScope): SQL {
  // 担当の範囲は1件以上（なければ authorizeTeamStatus が断る）
  if (scope.kind === "assigned")
    return sql`${col} IN (${sql.join(
      scope.accountIds.map((id) => sql`${id}`),
      sql`, `,
    )})`;
  return sql`${col} IN (SELECT ${teamAccounts.accountId} FROM ${teamAccounts} WHERE ${teamAccounts.teamId} = ${teamId})`;
}

/**
 * 日時の文字列（DBの値）を Date にする。
 * @param v - DBの値（NULL可）
 * @returns Date か null
 */
const toDate = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));

/**
 * 伸びを決める（research.md R4・R7）。
 * @param autopostOn - オーナーが自動投稿を使えるか（使えなければ反応数を取り込まない）
 * @param recent - 直近30日の中央値と件数
 * @param previous - その前の30日の中央値と件数
 * @returns 伸び
 */
function growthOf(
  autopostOn: boolean,
  recent: { median: number | null; count: number },
  previous: { median: number | null; count: number },
): TeamStatusGrowth {
  if (!autopostOn) return { state: "metrics_off" };
  if (recent.count < TEAM_STATUS_GROWTH_MIN_POSTS || previous.count < TEAM_STATUS_GROWTH_MIN_POSTS)
    return { state: "insufficient" };
  if (recent.median === null || previous.median === null || previous.median <= 0)
    return { state: "insufficient" };
  const raw = recent.median / previous.median;
  const ratio = Math.round(raw * 100) / 100;
  return {
    state: raw <= TEAM_STATUS_GROWTH_POOR_RATIO ? "poor" : "ok",
    ratio,
    recentMedian: recent.median,
    previousMedian: previous.median,
  };
}

/**
 * チームの運用状況を数える（contracts/api.md「GET /api/teams/:teamId/status」）。
 * @param db - データベース
 * @param teamAccess - authorizeTeamStatus の結果
 * @param scope - 見る範囲
 * @param now - 今の日時
 * @returns 運用状況
 */
export async function getTeamStatus(
  db: Db | TxDb,
  teamAccess: TeamAccess,
  scope: TeamStatusScope,
  now: Date = new Date(),
): Promise<TeamStatus> {
  const teamId = teamAccess.team.id;
  const me = teamAccess.member.id;
  const stoppedBefore = new Date(now.getTime() - TEAM_STATUS_STOPPED_DAYS * DAY_MS);
  const retentionBefore = new Date(now.getTime() - ACTIVITY_LOG_RETENTION_DAYS * DAY_MS);
  const recentFrom = new Date(now.getTime() - TEAM_STATUS_GROWTH_WINDOW_DAYS * DAY_MS);
  const previousFrom = new Date(now.getTime() - 2 * TEAM_STATUS_GROWTH_WINDOW_DAYS * DAY_MS);
  const ownerM = alias(memberships, "owner_m");
  const owner = alias(users, "owner_u");

  // ---- 人（範囲が担当なら、担当のAccountのオーナーだけ。編集者自身は出さない）----
  const actions = sql.join(
    TEAM_STATUS_ACTIVITY_ACTIONS.map((a) => sql`${a}`),
    sql`, `,
  );
  const activityIn = sql`activity_logs l WHERE l.actor_user_id = ${teamMembers.userId}
    AND ${inScope(sql`l.account_id`, teamId, scope)} AND l.action IN (${actions})`;
  const peopleRows = await db
    .select({
      userId: teamMembers.userId,
      role: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
      displayName: users.displayName,
      email: users.email,
      lastActiveAt: sql<Date | string | null>`(SELECT max(l.created_at) FROM ${activityIn})`,
      activeCount7d: sql<number>`(SELECT count(*) FROM ${activityIn} AND l.created_at > ${stoppedBefore.toISOString()})::int`,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        scope.kind === "assigned"
          ? sql`${teamMembers.userId} IN (SELECT ${memberships.userId} FROM ${memberships}
              WHERE ${memberships.role} = 'owner' AND ${inArray(memberships.accountId, scope.accountIds)})`
          : undefined,
      ),
    );

  const people: (Person & { origin: number })[] = peopleRows.map((r) => {
    const lastActiveAt = toDate(r.lastActiveAt);
    const joinedAt = new Date(r.joinedAt);
    const origin = Math.max(lastActiveAt?.getTime() ?? 0, joinedAt.getTime());
    return {
      userId: r.userId,
      name: personName(r),
      role: r.role,
      isMe: r.userId === me,
      joinedAt: joinedAt.toISOString(),
      lastActiveAt: lastActiveAt?.toISOString() ?? null,
      activeCount7d: r.activeCount7d,
      stopped: origin < stoppedBefore.getTime(),
      retentionLimited: lastActiveAt === null && joinedAt < retentionBefore,
      origin,
    };
  });

  // ---- Account ----
  const confirmed = (
    from: Date,
    to: Date,
  ) => sql`FROM post_metrics pm JOIN post_drafts d ON d.id = pm.draft_id
    WHERE pm.account_id = ${accounts.id} AND pm.state IN ('confirmed', 'late_confirmed') AND pm.views IS NOT NULL
      AND d.published_at >= ${from.toISOString()} AND d.published_at < ${to.toISOString()}`;
  const drafts = sql`FROM post_drafts d WHERE d.account_id = ${accounts.id}`;
  const accountRows = await db
    .select({
      account: accounts,
      addedAt: teamAccounts.addedAt,
      shared: teamAccounts.shared,
      ownerUserId: ownerM.userId,
      ownerDisplayName: owner.displayName,
      ownerEmail: owner.email,
      lastPostedAt: sql<
        Date | string | null
      >`(SELECT max(d.published_at) ${drafts} AND d.status = 'published')`,
      postCount7d: sql<number>`(SELECT count(*) ${drafts} AND d.status = 'published'
        AND d.published_at > ${stoppedBefore.toISOString()})::int`,
      approvedCount: sql<number>`(SELECT count(*) ${drafts} AND d.status IN ('approved', 'publishing'))::int`,
      needsReviewCount: sql<number>`(SELECT count(*) ${drafts} AND d.status = 'needs_review')::int`,
      autopostOn: featureOnSql(ownerM.userId, "autopost"),
      recentMedian: sql<
        number | null
      >`(SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY pm.views) ${confirmed(recentFrom, now)})`,
      recentCount: sql<number>`(SELECT count(*) ${confirmed(recentFrom, now)})::int`,
      previousMedian: sql<
        number | null
      >`(SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY pm.views) ${confirmed(previousFrom, recentFrom)})`,
      previousCount: sql<number>`(SELECT count(*) ${confirmed(previousFrom, recentFrom)})::int`,
    })
    .from(teamAccounts)
    .innerJoin(accounts, eq(accounts.id, teamAccounts.accountId))
    .innerJoin(ownerM, and(eq(ownerM.accountId, accounts.id), eq(ownerM.role, "owner")))
    .innerJoin(owner, eq(owner.id, ownerM.userId))
    .where(and(eq(teamAccounts.teamId, teamId), inScope(teamAccounts.accountId, teamId, scope)))
    .orderBy(teamAccounts.addedAt, accounts.id);

  const accountList: (AccountStatus & { origin: number })[] = accountRows.map((r) => {
    const lastPostedAt = toDate(r.lastPostedAt);
    const addedAt = new Date(r.addedAt);
    const origin = Math.max(lastPostedAt?.getTime() ?? 0, addedAt.getTime());
    // 画像は、見ている人が開けるAccountだけ（getTeamDetail と同じ）
    const canOpen = r.ownerUserId === me || r.shared || scope.kind === "assigned";
    return {
      accountId: r.account.id,
      name: r.account.name,
      username: r.account.username,
      displayName: r.account.displayName,
      profilePictureUrl: canOpen ? r.account.profilePictureUrl : null,
      owner: {
        userId: r.ownerUserId,
        name: personName({ displayName: r.ownerDisplayName, email: r.ownerEmail }),
        isMe: r.ownerUserId === me,
      },
      connection: r.account.connectionStatus === "connected" ? "connected" : "disconnected",
      addedAt: addedAt.toISOString(),
      lastPostedAt: lastPostedAt?.toISOString() ?? null,
      postCount7d: r.postCount7d,
      approvedCount: r.approvedCount,
      needsReviewCount: r.needsReviewCount,
      stopped: origin < stoppedBefore.getTime(),
      growth: growthOf(
        r.autopostOn,
        { median: r.recentMedian === null ? null : Number(r.recentMedian), count: r.recentCount },
        {
          median: r.previousMedian === null ? null : Number(r.previousMedian),
          count: r.previousCount,
        },
      ),
      origin,
    };
  });

  // ---- 並び（data-model.md「並び」）----
  people.sort((a, b) => {
    if (a.stopped !== b.stopped) return a.stopped ? -1 : 1;
    if (a.stopped) return a.origin - b.origin;
    return a.name.localeCompare(b.name, "ja");
  });
  const rank = (a: AccountStatus) => (a.stopped ? 0 : a.growth.state === "poor" ? 1 : 2);
  // Array.prototype.sort は安定なので、同じ順位の中はチームに入った順のまま
  accountList.sort(
    (a, b) => rank(a) - rank(b) || (a.stopped && b.stopped ? a.origin - b.origin : 0),
  );

  const strip = <T extends { origin: number }>({ origin: _origin, ...rest }: T) => rest;
  return {
    scope: scope.kind,
    generatedAt: now.toISOString(),
    stoppedCount:
      people.filter((p) => p.stopped).length + accountList.filter((a) => a.stopped).length,
    people: people.map(strip),
    accounts: accountList.map(strip),
  };
}
