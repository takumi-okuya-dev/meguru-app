// チームの運用状況（specs/020-team-monitoring、contracts/api.md、data-model.md、research.md R1〜R8）
import { neon } from "@neondatabase/serverless";
import type { TeamDetail, TeamStatus } from "@meguru/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb, setAccount, testEnv } from "../helpers/app";
import { approvedDrafts, confirmedMetrics, publishedDrafts } from "../helpers/auto-post";
import { disableFeatures } from "../helpers/features";
import { assign, joinTeam, makeTeam, setRole } from "../helpers/team";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

async function json<T>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; details?: string[] } }).error;

const status = (teamId: string, user: string) =>
  call(app, "GET", `/api/teams/${teamId}/status`, { user });

/**
 * 管理者 a1、オーナー o1、編集者 e1（o1 のアカウントの担当）、メンバー m1 のチーム。
 * 全員、入ってから1日たったことにする（「止まっている」が入った日時で決まらないように、テストごとに直す）。
 */
async function setup() {
  const { accountId: adminAcc } = await createUserWithAccount("a1");
  const { accountId: ownerAcc } = await createUserWithAccount("o1");
  const { accountId: editorAcc } = await createUserWithAccount("e1");
  const { accountId: memberAcc } = await createUserWithAccount("m1");
  const { teamId, adminUserId } = await makeTeam("a1", [adminAcc]);
  const o1 = await joinTeam(teamId, "o1", [ownerAcc]);
  const e1 = await joinTeam(teamId, "e1", [editorAcc]);
  const m1 = await joinTeam(teamId, "m1", [memberAcc]);
  await setRole(teamId, "e1", "editor");
  await assign(teamId, "e1", ownerAcc);
  await joinedAgo(teamId, 1);
  return { teamId, adminUserId, adminAcc, ownerAcc, editorAcc, memberAcc, o1, e1, m1 };
}

/** チームの全員とアカウントの、入った日時を days 日前へずらす（入った順は保つ）。 */
async function joinedAgo(teamId: string, days: number) {
  const secs = days * 24 * 60 * 60;
  await sql()`UPDATE team_members SET joined_at = joined_at - make_interval(secs => ${secs}) WHERE team_id = ${teamId}`;
  await sql()`UPDATE team_accounts SET added_at = added_at - make_interval(secs => ${secs}) WHERE team_id = ${teamId}`;
}

/** 人の入った日時をずらす。 */
async function memberJoinedAgo(teamId: string, userId: string, days: number) {
  await sql()`UPDATE team_members SET joined_at = ${ago(days).toISOString()} WHERE team_id = ${teamId} AND user_id = ${userId}`;
}

/** 操作の記録を直接入れる。 */
async function activity(
  accountId: string,
  actorUserId: string,
  action: string,
  daysAgo: number,
  kind = "draft",
) {
  await sql()`INSERT INTO activity_logs (account_id, actor_user_id, actor_name, actor_role, kind, action, created_at)
    VALUES (${accountId}, ${actorUserId}, 'x', 'owner', ${kind}, ${action}, ${ago(daysAgo).toISOString()})`;
}

/** 要確認の下書きを入れる。 */
async function needsReview(accountId: string, count: number, body = "要確認の本文") {
  const [b] =
    (await sql()`INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found)
    VALUES (${accountId}, gen_random_uuid(), ${count}, true) RETURNING id`) as [{ id: string }];
  for (let i = 0; i < count; i++) {
    await sql()`INSERT INTO post_drafts (account_id, batch_id, position, body) VALUES (${accountId}, ${b.id}, ${i}, ${body})`;
  }
}

/** 投稿した日（何日前）と閲覧数で、確定した投稿を作る。 */
async function confirmedPosts(accountId: string, items: { daysAgo: number; views: number }[]) {
  const drafts = await publishedDrafts(
    accountId,
    items.map((it) => ({ publishedAt: ago(it.daysAgo) })),
  );
  for (const [i, d] of drafts.entries()) await confirmedMetrics(accountId, d.id, items[i]!.views);
  return drafts;
}

const five = (daysAgo: number, views: number[]) =>
  views.map((v, i) => ({ daysAgo: daysAgo + i * 0.1, views: v }));

beforeEach(async () => {
  await resetDb();
});

describe("見られる人（FR-001、research.md R5）", () => {
  it("管理者は200で all、担当のある編集者は200で assigned", async () => {
    const { teamId } = await setup();
    expect((await json<TeamStatus>(await status(teamId, "a1"))).scope).toBe("all");
    expect((await json<TeamStatus>(await status(teamId, "e1"))).scope).toBe("assigned");
  });

  it("担当のない編集者とメンバーは ROLE_FORBIDDEN", async () => {
    const { teamId, ownerAcc, e1 } = await setup();
    const member = await status(teamId, "m1");
    expect([member.status, (await errorOf(member)).code]).toEqual([403, "ROLE_FORBIDDEN"]);
    await sql()`DELETE FROM memberships WHERE user_id = ${e1} AND account_id = ${ownerAcc}`;
    const editor = await status(teamId, "e1");
    expect([editor.status, (await errorOf(editor)).code]).toEqual([403, "ROLE_FORBIDDEN"]);
  });

  it("チームの人でない・チームがない・IDの形が違うは TEAM_NOT_FOUND", async () => {
    const { teamId } = await setup();
    await createUserWithAccount("x1");
    for (const [id, user] of [
      [teamId, "x1"],
      [crypto.randomUUID(), "a1"],
      ["not-a-uuid", "a1"],
    ] as const) {
      const res = await status(id, user);
      expect([res.status, (await errorOf(res)).code]).toEqual([404, "TEAM_NOT_FOUND"]);
    }
  });

  it("見る人のチームのまとまりがOFFなら FEATURE_DISABLED", async () => {
    const { teamId, adminUserId } = await setup();
    await disableFeatures(adminUserId, "team");
    const res = await status(teamId, "a1");
    expect([
      res.status,
      (await errorOf(res)).code,
      (await errorOf(await status(teamId, "a1"))).details,
    ]).toEqual([403, "FEATURE_DISABLED", ["team"]]);
  });

  it("GET /api/teams/:teamId の statusVisible：管理者と担当のある編集者は真、担当のない編集者とメンバーは偽", async () => {
    const { teamId, ownerAcc, e1 } = await setup();
    const visible = async (user: string) =>
      (await json<TeamDetail>(await call(app, "GET", `/api/teams/${teamId}`, { user })))
        .statusVisible;
    expect([
      await visible("a1"),
      await visible("e1"),
      await visible("m1"),
      await visible("o1"),
    ]).toEqual([true, true, false, false]);
    await sql()`DELETE FROM memberships WHERE user_id = ${e1} AND account_id = ${ownerAcc}`;
    expect(await visible("e1")).toBe(false);
  });
});

describe("人の運用状況（FR-010、research.md R1〜R3）", () => {
  it("チームのアカウントでの、案を作る・直す・承認・却下だけを数える", async () => {
    const { teamId, ownerAcc, o1 } = await setup();
    const { accountId: outside } = await createUserWithAccount("o1");
    await activity(ownerAcc, o1, "drafts_registered", 0.5);
    await activity(ownerAcc, o1, "draft_edited", 1);
    await activity(ownerAcc, o1, "drafts_approved", 2, "review");
    await activity(ownerAcc, o1, "drafts_rejected", 3, "review");
    await activity(ownerAcc, o1, "strategy_saved", 0.1, "content");
    await activity(outside, o1, "drafts_approved", 0.1, "review");
    await activity(ownerAcc, o1, "drafts_approved", 8, "review");
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    const p = res.people.find((x) => x.userId === o1)!;
    expect(p.activeCount7d).toBe(4);
    expect(Date.now() - Date.parse(p.lastActiveAt!)).toBeGreaterThan(0.4 * DAY);
    expect(Date.now() - Date.parse(p.lastActiveAt!)).toBeLessThan(0.6 * DAY);
    expect(p.stopped).toBe(false);
  });

  it("止まっている：入って8日・記録なしは真、入って3日・記録なしは偽、8日前に承認は真", async () => {
    const { teamId, ownerAcc, o1, e1, m1 } = await setup();
    await memberJoinedAgo(teamId, o1, 8);
    await memberJoinedAgo(teamId, m1, 3);
    await memberJoinedAgo(teamId, e1, 20);
    await activity(ownerAcc, e1, "drafts_approved", 8, "review");
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    const byId = new Map(res.people.map((p) => [p.userId, p]));
    expect([byId.get(o1)!.stopped, byId.get(m1)!.stopped, byId.get(e1)!.stopped]).toEqual([
      true,
      false,
      true,
    ]);
    expect(byId.get(o1)!.lastActiveAt).toBeNull();
    expect(byId.get(e1)!.activeCount7d).toBe(0);
  });

  it("記録がなく入って100日なら retentionLimited、30日なら偽", async () => {
    const { teamId, o1, m1 } = await setup();
    await memberJoinedAgo(teamId, o1, 100);
    await memberJoinedAgo(teamId, m1, 30);
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    const byId = new Map(res.people.map((p) => [p.userId, p]));
    expect([byId.get(o1)!.retentionLimited, byId.get(m1)!.retentionLimited]).toEqual([true, false]);
  });

  it("担当を外される前に、そのアカウントで承認した動きも数える", async () => {
    const { teamId, ownerAcc, e1 } = await setup();
    await activity(ownerAcc, e1, "drafts_approved", 1, "review");
    await sql()`DELETE FROM memberships WHERE user_id = ${e1} AND account_id = ${ownerAcc}`;
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    expect(res.people.find((p) => p.userId === e1)!.activeCount7d).toBe(1);
  });

  it("チームを抜けた人と、その人が入れていたアカウントは出ない", async () => {
    const { teamId, memberAcc, m1 } = await setup();
    await sql()`DELETE FROM team_accounts WHERE team_id = ${teamId} AND account_id = ${memberAcc}`;
    await sql()`DELETE FROM team_members WHERE team_id = ${teamId} AND user_id = ${m1}`;
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    expect(res.people.some((p) => p.userId === m1)).toBe(false);
    expect(res.accounts.some((a) => a.accountId === memberAcc)).toBe(false);
  });
});

describe("アカウントの運用状況（FR-011）", () => {
  it("最後の投稿・7日の投稿・承認済み・要確認・接続・オーナー", async () => {
    const { teamId, ownerAcc, o1 } = await setup();
    await publishedDrafts(ownerAcc, [
      { publishedAt: ago(0.5) },
      { publishedAt: ago(2) },
      { publishedAt: ago(9) },
    ]);
    await approvedDrafts(ownerAcc, ["a", "b"]);
    await needsReview(ownerAcc, 3);
    await setAccount(ownerAcc, { connectionStatus: "needs_reconnect" });
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    const a = res.accounts.find((x) => x.accountId === ownerAcc)!;
    expect([a.postCount7d, a.approvedCount, a.needsReviewCount, a.connection, a.stopped]).toEqual([
      2,
      2,
      3,
      "disconnected",
      false,
    ]);
    expect(Date.now() - Date.parse(a.lastPostedAt!)).toBeLessThan(0.6 * DAY);
    expect(a.owner).toEqual({ userId: o1, name: "o1", isMe: false });
  });

  it("止まっている：最後の投稿か入った日時から7日より長い。stoppedCount は人とアカウントの和", async () => {
    const { teamId, adminAcc, ownerAcc, editorAcc, memberAcc, adminUserId, o1, e1, m1 } =
      await setup();
    await joinedAgo(teamId, 19);
    await publishedDrafts(adminAcc, [{ publishedAt: ago(1) }]);
    await publishedDrafts(ownerAcc, [{ publishedAt: ago(8) }]);
    for (const [acc, user] of [
      [adminAcc, adminUserId],
      [ownerAcc, o1],
      [editorAcc, e1],
      [memberAcc, m1],
    ] as const) {
      await activity(acc, user, "drafts_registered", 1);
    }
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    const stopped = res.accounts.filter((a) => a.stopped).map((a) => a.accountId);
    expect(new Set(stopped)).toEqual(new Set([ownerAcc, editorAcc, memberAcc]));
    expect(res.stoppedCount).toBe(3);
  });

  it("並び：止まっているものが先（起点の古い順）。印のない人は名前の順、アカウントは入った順", async () => {
    const { teamId, adminAcc, ownerAcc, editorAcc, memberAcc, adminUserId, o1, e1, m1 } =
      await setup();
    await memberJoinedAgo(teamId, o1, 10);
    await memberJoinedAgo(teamId, m1, 20);
    await activity(adminAcc, adminUserId, "drafts_registered", 1);
    await activity(editorAcc, e1, "drafts_registered", 1);
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    expect(res.people.map((p) => p.name)).toEqual(["m1", "o1", "a1", "e1"]);
    await sql()`UPDATE team_accounts SET added_at = ${ago(30).toISOString()} WHERE account_id = ${memberAcc}`;
    const again = await json<TeamStatus>(await status(teamId, "a1"));
    expect(again.accounts.map((a) => a.accountId)).toEqual([
      memberAcc,
      adminAcc,
      ownerAcc,
      editorAcc,
    ]);
  });

  it("投稿の本文・戦略の文字は返さない（SC-004）", async () => {
    const { teamId, ownerAcc } = await setup();
    await publishedDrafts(ownerAcc, [{ body: "ひみつの投稿の本文", publishedAt: ago(1) }]);
    await needsReview(ownerAcc, 1, "ひみつの要確認");
    const text = await (await status(teamId, "a1")).text();
    expect(text).not.toContain("ひみつ");
  });

  it("問い合わせは、アカウントの数によらず同じ回数で済む（SC-002）", async () => {
    const { teamId } = await setup();
    for (let i = 0; i < 16; i++) {
      const { accountId } = await createUserWithAccount(`z${i}`);
      await joinTeam(teamId, `z${i}`, [accountId]);
      await publishedDrafts(accountId, [{ publishedAt: ago(1) }]);
    }
    const started = Date.now();
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    expect(res.accounts).toHaveLength(20);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("伸び（FR-020〜FR-022、research.md R4・R7）", () => {
  async function growthOf(recent: number[], previous: number[]) {
    const { teamId, ownerAcc } = await setup();
    await confirmedPosts(ownerAcc, [...five(1, recent), ...five(31, previous)]);
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    return { res, a: res.accounts.find((x) => x.accountId === ownerAcc)! };
  }

  it("中央値の比が0.6なら poor（比と中央値を返す）", async () => {
    const { a } = await growthOf([60, 50, 60, 70, 60], [100, 90, 100, 110, 100]);
    expect(a.growth).toEqual({ state: "poor", ratio: 0.6, recentMedian: 60, previousMedian: 100 });
  });

  it("0.8ちょうどは poor、1.3は ok", async () => {
    expect((await growthOf([80, 80, 80, 80, 80], [100, 100, 100, 100, 100])).a.growth.state).toBe(
      "poor",
    );
    await resetDb();
    expect((await growthOf([130, 130, 130, 130, 130], [100, 100, 100, 100, 100])).a.growth).toEqual(
      {
        state: "ok",
        ratio: 1.3,
        recentMedian: 130,
        previousMedian: 100,
      },
    );
  });

  it("どちらかが4件、または前の中央値が0なら insufficient", async () => {
    expect((await growthOf([60, 60, 60, 60], [100, 100, 100, 100, 100])).a.growth).toEqual({
      state: "insufficient",
    });
    await resetDb();
    expect((await growthOf([60, 60, 60, 60, 60], [0, 0, 0, 0, 0])).a.growth).toEqual({
      state: "insufficient",
    });
  });

  it("確定していない・計測できない投稿は数えない", async () => {
    const { teamId, ownerAcc } = await setup();
    await confirmedPosts(ownerAcc, [
      ...five(1, [60, 60, 60, 60]),
      ...five(31, [100, 100, 100, 100, 100]),
    ]);
    const [updating, unmeasurable] = await publishedDrafts(ownerAcc, [
      { publishedAt: ago(2) },
      { publishedAt: ago(2) },
    ]);
    await sql()`INSERT INTO post_metrics (draft_id, account_id, state, views) VALUES (${updating!.id}, ${ownerAcc}, 'updating', 10)`;
    await sql()`INSERT INTO post_metrics (draft_id, account_id, state, unmeasurable_reason)
      VALUES (${unmeasurable!.id}, ${ownerAcc}, 'unmeasurable', 'not_found')`;
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    expect(res.accounts.find((x) => x.accountId === ownerAcc)!.growth).toEqual({
      state: "insufficient",
    });
  });

  it("オーナーの自動投稿がOFFなら metrics_off。止まっているはそのまま数える", async () => {
    const { teamId, ownerAcc, o1 } = await setup();
    await joinedAgo(teamId, 19);
    await confirmedPosts(ownerAcc, [
      ...five(31, [60, 60, 60, 60, 60]),
      ...five(40, [100, 100, 100, 100, 100]),
    ]);
    await disableFeatures(o1, "autopost");
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    const a = res.accounts.find((x) => x.accountId === ownerAcc)!;
    expect([a.growth, a.stopped]).toEqual([{ state: "metrics_off" }, true]);
  });

  it("並び：止まっているアカウントの次に poor", async () => {
    const { teamId, adminAcc, ownerAcc, editorAcc, memberAcc } = await setup();
    await sql()`UPDATE team_accounts SET added_at = ${ago(30).toISOString()} WHERE account_id = ${memberAcc}`;
    await publishedDrafts(adminAcc, [{ publishedAt: ago(1) }]);
    await publishedDrafts(editorAcc, [{ publishedAt: ago(1) }]);
    await confirmedPosts(ownerAcc, [
      ...five(1, [60, 60, 60, 60, 60]),
      ...five(31, [100, 100, 100, 100, 100]),
    ]);
    const res = await json<TeamStatus>(await status(teamId, "a1"));
    expect(res.accounts.map((a) => a.accountId)).toEqual([
      memberAcc,
      ownerAcc,
      adminAcc,
      editorAcc,
    ]);
  });
});

describe("編集者の範囲（FR-002a、research.md R5・R6）", () => {
  it("担当のアカウントとそのオーナーだけ。編集者自身は出ない", async () => {
    const { teamId, ownerAcc, o1 } = await setup();
    const res = await json<TeamStatus>(await status(teamId, "e1"));
    expect(res.accounts.map((a) => a.accountId)).toEqual([ownerAcc]);
    expect(res.people.map((p) => p.userId)).toEqual([o1]);
  });

  it("オーナーの行の動きは、担当のアカウントでの動きだけを数える", async () => {
    const { teamId, ownerAcc, o1 } = await setup();
    const { accountId: second } = await createUserWithAccount("o1");
    await sql()`INSERT INTO team_accounts (team_id, account_id, added_by_user_id) VALUES (${teamId}, ${second}, ${o1})`;
    await activity(ownerAcc, o1, "drafts_approved", 1, "review");
    await activity(second, o1, "drafts_approved", 0.5, "review");
    await activity(second, o1, "drafts_approved", 0.6, "review");
    const editor = await json<TeamStatus>(await status(teamId, "e1"));
    expect(editor.people[0]!.activeCount7d).toBe(1);
    expect(editor.accounts.map((a) => a.accountId)).toEqual([ownerAcc]);
    const admin = await json<TeamStatus>(await status(teamId, "a1"));
    expect(admin.people.find((p) => p.userId === o1)!.activeCount7d).toBe(3);
  });

  it("stoppedCount に担当の外の人とアカウントが入らない", async () => {
    const { teamId, ownerAcc, o1 } = await setup();
    await joinedAgo(teamId, 19);
    await activity(ownerAcc, o1, "drafts_registered", 1);
    await publishedDrafts(ownerAcc, [{ publishedAt: ago(1) }]);
    expect((await json<TeamStatus>(await status(teamId, "e1"))).stoppedCount).toBe(0);
    expect((await json<TeamStatus>(await status(teamId, "a1"))).stoppedCount).toBeGreaterThan(0);
  });

  it("オーナーのチームがOFFの担当のアカウントは出ない。すべてそうなら ROLE_FORBIDDEN", async () => {
    const { teamId, memberAcc, o1 } = await setup();
    await assign(teamId, "e1", memberAcc);
    await disableFeatures(o1, "team");
    const res = await json<TeamStatus>(await status(teamId, "e1"));
    expect(res.accounts.map((a) => a.accountId)).toEqual([memberAcc]);
    await sql()`DELETE FROM memberships WHERE account_id = ${memberAcc} AND role = 'editor'`;
    const none = await status(teamId, "e1");
    expect([none.status, (await errorOf(none)).code]).toEqual([403, "ROLE_FORBIDDEN"]);
    expect(
      (await json<TeamDetail>(await call(app, "GET", `/api/teams/${teamId}`, { user: "e1" })))
        .statusVisible,
    ).toBe(false);
  });

  it("担当を外すと、次の読み込みから消える", async () => {
    const { teamId, ownerAcc, memberAcc, e1 } = await setup();
    await assign(teamId, "e1", memberAcc);
    expect((await json<TeamStatus>(await status(teamId, "e1"))).accounts).toHaveLength(2);
    await sql()`DELETE FROM memberships WHERE user_id = ${e1} AND account_id = ${ownerAcc}`;
    expect(
      (await json<TeamStatus>(await status(teamId, "e1"))).accounts.map((a) => a.accountId),
    ).toEqual([memberAcc]);
  });
});

describe("見せない人（SC-003）", () => {
  it("メンバー・別のチームの人・関わりのない人の応答に、数もIDも入らない", async () => {
    const { teamId, ownerAcc, o1 } = await setup();
    await createUserWithAccount("x1");
    for (const user of ["m1", "o1", "x1"]) {
      const text = await (await status(teamId, user)).text();
      expect(text).not.toContain(ownerAcc);
      expect(text).not.toContain(o1);
      expect(text).not.toContain("stoppedCount");
    }
  });

  it("編集者の応答に、担当の外のアカウントのIDが出ない", async () => {
    const { teamId, adminAcc, editorAcc, memberAcc } = await setup();
    const text = await (await status(teamId, "e1")).text();
    for (const id of [adminAcc, editorAcc, memberAcc]) expect(text).not.toContain(id);
  });
});
