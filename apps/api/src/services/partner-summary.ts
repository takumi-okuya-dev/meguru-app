// 手伝っているアカウントのまとめ（specs/008-team-operations contracts/api.md「GET /api/team/accounts」、research.md R12）。
// Accountの一覧は access.ts の listTeamAccounts から受け取る（Constitution原則V）。
// 件数・判定・担当は Account をまとめて1回ずつ読む。次の投稿の時刻は 005 の計算を、自動投稿がオンの Account ごとに使う。
import { PARTNER_SUMMARY_LIMIT } from "@threads-grower/shared";
import { and, count, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { memberships, postDrafts, postMetrics, postingSchedules, users } from "../db/schema";
import { listTeamAccounts, personName, type TeamAccess } from "./access";
import { upcomingSlots } from "./auto-post-status";
import { toAutoPostState } from "./posting-schedule-service";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 手伝っているアカウントのまとめ（FR-061）。要確認の多い順（同じなら表示名の順）、最大100件。
 * @param db - データベース
 * @param teamAccess - authorizeTeam の結果
 * @param now - 現在時刻
 * @returns 行と、100件を超えたか
 */
export async function getPartnerSummary(db: Db, teamAccess: TeamAccess, now: Date = new Date()) {
  const helped = (await listTeamAccounts(db, teamAccess)).filter((a) => !a.own);
  if (helped.length === 0) return { items: [], truncated: false };
  const ids = helped.map((a) => a.account.id);
  const [statusCounts, schedules, judgments, editors] = await Promise.all([
    db
      .select({ accountId: postDrafts.accountId, status: postDrafts.status, n: count() })
      .from(postDrafts)
      .where(and(inArray(postDrafts.accountId, ids), inArray(postDrafts.status, ["needs_review", "approved"])))
      .groupBy(postDrafts.accountId, postDrafts.status),
    db.select().from(postingSchedules).where(inArray(postingSchedules.accountId, ids)),
    db
      .select({ accountId: postMetrics.accountId, judgment: postMetrics.judgment, n: count() })
      .from(postMetrics)
      .where(
        and(
          inArray(postMetrics.accountId, ids),
          isNotNull(postMetrics.judgment),
          gte(postMetrics.judgedAt, new Date(now.getTime() - 7 * DAY_MS)),
        ),
      )
      .groupBy(postMetrics.accountId, postMetrics.judgment),
    db
      .select({ accountId: memberships.accountId, userId: users.id, displayName: users.displayName, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(inArray(memberships.accountId, ids), eq(memberships.role, "editor"), eq(memberships.teamId, teamAccess.team.id))),
  ]);
  const countOf = (accountId: string, status: string) =>
    Number(statusCounts.find((r) => r.accountId === accountId && r.status === status)?.n ?? 0);
  const judgmentOf = (accountId: string, j: string) =>
    Number(judgments.find((r) => r.accountId === accountId && r.judgment === j)?.n ?? 0);

  const items = await Promise.all(
    helped.map(async ({ account, owner, delegation }) => {
      const schedule = schedules.find((s) => s.accountId === account.id) ?? null;
      const state = toAutoPostState(account, schedule, now);
      const approved = countOf(account.id, "approved");
      let nextPost: { at: string | null; state: "scheduled" | "off" | "paused" | "none" };
      if (!state.enabled) nextPost = { at: null, state: "off" };
      else if (state.stoppedReason) nextPost = { at: null, state: "paused" };
      else {
        const [at] = await upcomingSlots(db, account, schedule, now, 1);
        nextPost = { at: at?.toISOString() ?? null, state: approved > 0 && at ? "scheduled" : "none" };
      }
      return {
        account: {
          id: account.id,
          displayName: account.displayName,
          username: account.username,
          profilePictureUrl: account.profilePictureUrl,
          connectionStatus: account.connectionStatus,
        },
        ownerName: owner.name,
        needsReview: countOf(account.id, "needs_review"),
        approved: { count: approved, days: state.slotCount ? Math.floor(approved / state.slotCount) : null },
        nextPost,
        judgments7d: {
          good: judgmentOf(account.id, "good"),
          normal: judgmentOf(account.id, "normal"),
          poor: judgmentOf(account.id, "poor"),
        },
        delegation: delegation ?? { review: false, settings: false },
        editors: editors.filter((e) => e.accountId === account.id).map((e) => ({ userId: e.userId, name: personName(e) })),
      };
    }),
  );
  const label = (i: (typeof items)[number]) => i.account.displayName ?? i.account.username;
  items.sort((a, b) => b.needsReview - a.needsReview || label(a).localeCompare(label(b), "ja"));
  return { items: items.slice(0, PARTNER_SUMMARY_LIMIT), truncated: items.length > PARTNER_SUMMARY_LIMIT };
}
