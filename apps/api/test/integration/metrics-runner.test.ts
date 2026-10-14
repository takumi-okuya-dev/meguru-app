// 反応数の段階（specs/006-performance-feedback contracts/metrics-job.md、FR-001〜FR-010、SC-002・SC-008・SC-009、research.md R2〜R5・R10・R11）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AFTER_TRIAL, fake, makeApp, resetDb, testEnv } from "../helpers/app";
import {
  addMin,
  approvedDrafts,
  clearCatchup,
  confirmedMetrics,
  connectedAccount,
  db,
  jst,
  markCatchupDone,
  metricsRow,
  publishedDrafts,
  run,
  setSchedule,
  snapshotsOf,
} from "../helpers/auto-post";

const app = makeApp();
const NOON = jst("2030-01-10 12:00");
const TODAY = "2030-01-10";
const hoursAgo = (h: number, from: Date = NOON) => new Date(from.getTime() - h * 3600_000);

/**
 * grower機能を使えるAccount（テストの「今」は2030年で、無料体験の外になるため、プラン2にする）。
 * @param user - Clerk のユーザーID
 * @returns accountId と、ThreadsのユーザーID
 */
async function growerAccount(user: string) {
  const a = await connectedAccount(user, app);
  await db()`UPDATE accounts SET plan = 'auto-grower' WHERE id = ${a.accountId}`;
  return a;
}

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await clearCatchup();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("時点の取り込み（FR-002d）", () => {
  it("24時間・3日・7日の±1時間の投稿を、時刻の処理で取る。幅の外は取らない。二重に取らない", async () => {
    const { accountId } = await growerAccount("u1");
    await markCatchupDone(TODAY);
    const [d24, d72, d168, d10, d48] = await publishedDrafts(accountId, [
      { publishedAt: hoursAgo(24.5) },
      { publishedAt: hoursAgo(71.2) },
      { publishedAt: hoursAgo(168) },
      { publishedAt: hoursAgo(10) },
      { publishedAt: hoursAgo(48) },
    ]);
    await fake.setInsights(d24!.mediaId!, { views: 40, likes: 2 });
    await fake.setInsights(d72!.mediaId!, { views: 55 });
    await fake.setInsights(d168!.mediaId!, { views: 70, replies: 3 });

    await run(NOON);

    expect((await snapshotsOf(d24!.id)).map((s) => [s.kind, s.method, s.views])).toEqual([["h24", "slot", 40]]);
    expect((await snapshotsOf(d72!.id)).map((s) => [s.kind, s.method])).toEqual([["d3", "slot"]]);
    expect((await snapshotsOf(d168!.id)).map((s) => [s.kind, s.method])).toEqual([["d7", "slot"]]);
    expect(await snapshotsOf(d10!.id)).toEqual([]);
    expect(await snapshotsOf(d48!.id)).toEqual([]);

    expect(await metricsRow(d24!.id)).toMatchObject({ state: "updating", views: 40, likes: 2, last_kind: "h24" });
    expect(await metricsRow(d72!.id)).toMatchObject({ state: "updating", views: 55, last_kind: "d3" });
    const d7 = await metricsRow(d168!.id);
    expect(d7).toMatchObject({ state: "confirmed", views: 70, replies: 3, last_kind: "d7", last_elapsed_minutes: 168 * 60 });
    expect(d7!.confirmed_at).not.toBeNull();
    expect(await metricsRow(d10!.id)).toBeUndefined();

    const before = (await fake.callCounts()).insights;
    await run(addMin(NOON, 5));
    expect((await fake.callCounts()).insights).toBe(before);
    expect(await snapshotsOf(d24!.id)).toHaveLength(1);
  });
});

describe("補い（毎日の処理。FR-002・FR-004）", () => {
  it("3:00を過ぎた最初の回に、過ぎた時点のうち最も新しい1つだけを取り、遅れて確定・計測できないを決める", async () => {
    const { accountId } = await growerAccount("u1");
    const [p30, p80, p180, p10d, noMedia] = await publishedDrafts(accountId, [
      { publishedAt: hoursAgo(30) },
      { publishedAt: hoursAgo(80) },
      { publishedAt: hoursAgo(180) },
      { publishedAt: hoursAgo(240) },
      { publishedAt: hoursAgo(50), mediaId: null },
    ]);
    // 80時間の投稿は24時間を取ってある
    await db()`INSERT INTO post_metric_snapshots (draft_id, account_id, kind, method, fetched_at, elapsed_minutes, views)
      VALUES (${p80!.id}, ${accountId}, 'h24', 'slot', ${hoursAgo(56).toISOString()}, 1440, 5)`;
    await db()`INSERT INTO post_metrics (draft_id, account_id, state, views, last_fetched_at, last_elapsed_minutes, last_kind)
      VALUES (${p80!.id}, ${accountId}, 'updating', 5, ${hoursAgo(56).toISOString()}, 1440, 'h24')`;
    await fake.setInsights(p10d!.mediaId!, { views: 900 });

    await run(NOON);

    expect((await snapshotsOf(p30!.id)).map((s) => [s.kind, s.method])).toEqual([["h24", "daily"]]);
    expect((await snapshotsOf(p80!.id)).map((s) => s.kind)).toEqual(["h24", "d3"]);
    expect((await snapshotsOf(p180!.id)).map((s) => [s.kind, s.method])).toEqual([["d7", "daily"]]);
    expect(await metricsRow(p180!.id)).toMatchObject({ state: "confirmed" });
    expect((await snapshotsOf(p10d!.id)).map((s) => s.kind)).toEqual(["late"]);
    expect(await metricsRow(p10d!.id)).toMatchObject({ state: "late_confirmed", views: 900, last_kind: "late" });
    expect(await metricsRow(noMedia!.id)).toMatchObject({ state: "unmeasurable", unmeasurable_reason: "no_media_id" });
    expect(await snapshotsOf(noMedia!.id)).toEqual([]);
    expect(await testEnv.AUTOPOST_KV.get("metrics:catchup")).toBe(TODAY);

    const before = (await fake.callCounts()).insights;
    await run(addMin(NOON, 5));
    expect((await fake.callCounts()).insights).toBe(before);
  });

  it("3:00より前の回では補わない", async () => {
    const { accountId } = await growerAccount("u1");
    const [p] = await publishedDrafts(accountId, [{ publishedAt: hoursAgo(30, jst("2030-01-10 02:00")) }]);
    await run(jst("2030-01-10 02:00"));
    expect(await snapshotsOf(p!.id)).toEqual([]);
    expect(await testEnv.AUTOPOST_KV.get("metrics:catchup")).toBeNull();
  });

  it("補いが1回で終わらなければ、関所を次の回にして続ける", async () => {
    const { accountId } = await growerAccount("u1");
    const items = Array.from({ length: 30 }, () => ({ publishedAt: hoursAgo(30) }));
    await publishedDrafts(accountId, items);
    await run(NOON);
    const gate = JSON.parse((await testEnv.AUTOPOST_KV.get("autopost:gate"))!) as { nextCheckAt: string };
    expect(gate.nextCheckAt).toBe(NOON.toISOString());
    expect(await testEnv.AUTOPOST_KV.get("metrics:catchup")).toBeNull();
    await run(addMin(NOON, 5));
    expect(await testEnv.AUTOPOST_KV.get("metrics:catchup")).toBe(TODAY);
    const [{ n }] = (await db()`SELECT count(*)::int AS n FROM post_metric_snapshots WHERE account_id = ${accountId}`) as [
      { n: number },
    ];
    expect(n).toBe(30);
  });

  it("フォロワー数を、直近30日に投稿したAccountで1日1回記録する", async () => {
    const active = await growerAccount("u1");
    const idle = await growerAccount("u2");
    await publishedDrafts(active.accountId, [{ publishedAt: hoursAgo(10) }]);
    await publishedDrafts(idle.accountId, [{ publishedAt: hoursAgo(40 * 24) }]);
    await fake.setFollowers(active.threadsUserId, 321);
    await fake.setFollowers(idle.threadsUserId, 999);

    await run(NOON);
    await run(addMin(NOON, 5));

    const rows = (await db()`SELECT account_id, snapshot_date::text AS d, followers_count FROM follower_snapshots`) as {
      account_id: string;
      d: string;
      followers_count: number;
    }[];
    expect(rows).toEqual([{ account_id: active.accountId, d: TODAY, followers_count: 321 }]);
    expect((await fake.callCounts()).followers).toBe(1);
  });
});

describe("判定（FR-007〜FR-010、SC-002）", () => {
  it("確定が4件では判定しない。5件目の確定で、それまでの確定もまとめて判定する（境界の2.0倍・0.5倍）", async () => {
    const { accountId } = await growerAccount("u1");
    await markCatchupDone(TODAY);
    const old = await publishedDrafts(accountId, [
      { publishedAt: hoursAgo(300) },
      { publishedAt: hoursAgo(301) },
      { publishedAt: hoursAgo(302) },
      { publishedAt: hoursAgo(303) },
    ]);
    for (const [i, v] of [100, 25, 50, 50].entries()) await confirmedMetrics(accountId, old[i]!.id, v);
    const [fifth] = await publishedDrafts(accountId, [{ publishedAt: hoursAgo(168) }]);
    await fake.setInsights(fifth!.mediaId!, { views: 50 });

    await run(NOON);

    const j = async (id: string) => {
      const r = await metricsRow(id);
      return [r!.judgment, r!.judgment_baseline, r!.judgment_ratio];
    };
    expect(await j(old[0]!.id)).toEqual(["good", 50, 2]);
    expect(await j(old[1]!.id)).toEqual(["poor", 50, 0.5]);
    expect(await j(old[2]!.id)).toEqual(["normal", 50, 1]);
    expect(await j(fifth!.id)).toEqual(["normal", 50, 1]);
  });

  it("4件のままなら判定しない", async () => {
    const { accountId } = await growerAccount("u1");
    await markCatchupDone(TODAY);
    const old = await publishedDrafts(accountId, [{ publishedAt: hoursAgo(300) }, { publishedAt: hoursAgo(301) }, { publishedAt: hoursAgo(302) }]);
    for (const d of old) await confirmedMetrics(accountId, d.id, 50);
    const [fourth] = await publishedDrafts(accountId, [{ publishedAt: hoursAgo(168) }]);
    await run(NOON);
    expect(await metricsRow(fourth!.id)).toMatchObject({ state: "confirmed", judgment: null });
  });

  it("遅れて確定は判定するが、基準値には使わない。基準値0なら判定しない。確定した判定は後で変わらない", async () => {
    const { accountId } = await growerAccount("u1");
    const old = await publishedDrafts(accountId, Array.from({ length: 5 }, (_, i) => ({ publishedAt: hoursAgo(300 + i) })));
    for (const d of old) await confirmedMetrics(accountId, d.id, 50);
    const [late] = await publishedDrafts(accountId, [{ publishedAt: hoursAgo(400) }]);
    await fake.setInsights(late!.mediaId!, { views: 1000 });
    // 補いで遅れて確定を取る
    await run(NOON);
    expect(await metricsRow(late!.id)).toMatchObject({ state: "late_confirmed", judgment: "good", judgment_baseline: 50 });
    // 既存の確定も、5件たまった時点の基準値で判定されている
    expect(await metricsRow(old[0]!.id)).toMatchObject({ judgment: "normal", judgment_baseline: 50 });

    // 閲覧数の多い確定が増えて基準値が変わっても、前の判定は変わらない
    await markCatchupDone(TODAY);
    const more = await publishedDrafts(accountId, Array.from({ length: 5 }, () => ({ publishedAt: hoursAgo(168) })));
    for (const d of more) await fake.setInsights(d.mediaId!, { views: 500 });
    await run(addMin(NOON, 5));
    expect(await metricsRow(old[0]!.id)).toMatchObject({ judgment: "normal", judgment_baseline: 50 });
  });

  it("基準値が0なら判定しない", async () => {
    const { accountId } = await growerAccount("u1");
    await markCatchupDone(TODAY);
    const old = await publishedDrafts(accountId, Array.from({ length: 5 }, (_, i) => ({ publishedAt: hoursAgo(300 + i) })));
    for (const d of old) await confirmedMetrics(accountId, d.id, 0);
    const [p] = await publishedDrafts(accountId, [{ publishedAt: hoursAgo(168) }]);
    await fake.setInsights(p!.mediaId!, { views: 10 });
    await run(NOON);
    expect(await metricsRow(p!.id)).toMatchObject({ state: "confirmed", judgment: null });
  });
});

describe("失敗の扱い（research.md R11）", () => {
  it("投稿が見つからなければ計測できませんにし、それまでの値と履歴は残す", async () => {
    const { accountId } = await growerAccount("u1");
    await markCatchupDone(TODAY);
    const [p] = await publishedDrafts(accountId, [{ publishedAt: hoursAgo(72) }]);
    await db()`INSERT INTO post_metric_snapshots (draft_id, account_id, kind, method, fetched_at, elapsed_minutes, views)
      VALUES (${p!.id}, ${accountId}, 'h24', 'slot', ${hoursAgo(48).toISOString()}, 1440, 10)`;
    await db()`INSERT INTO post_metrics (draft_id, account_id, state, views, last_fetched_at, last_elapsed_minutes, last_kind)
      VALUES (${p!.id}, ${accountId}, 'updating', 10, ${hoursAgo(48).toISOString()}, 1440, 'h24')`;
    await fake.insightsFail(p!.mediaId!, "not_found", -1);

    await run(NOON);

    expect(await metricsRow(p!.id)).toMatchObject({ state: "unmeasurable", unmeasurable_reason: "not_found", views: 10 });
    expect(await snapshotsOf(p!.id)).toHaveLength(1);
  });

  it("権限がなければAccountに印を付け、その日はそのAccountを飛ばす。ほかのAccountは続ける", async () => {
    const denied = await growerAccount("u1");
    const ok = await growerAccount("u2");
    await markCatchupDone(TODAY);
    const [pd, pd2] = await publishedDrafts(denied.accountId, [{ publishedAt: hoursAgo(24) }, { publishedAt: hoursAgo(72) }]);
    const [po] = await publishedDrafts(ok.accountId, [{ publishedAt: hoursAgo(24) }]);
    await fake.insightsFail(`user:${denied.threadsUserId}`, "permission", -1);

    await run(NOON);

    const [acc] = (await db()`SELECT insights_denied_at FROM accounts WHERE id = ${denied.accountId}`) as [
      { insights_denied_at: string | null },
    ];
    expect(acc.insights_denied_at).not.toBeNull();
    expect(await metricsRow(pd!.id)).toBeUndefined();
    expect(await metricsRow(pd2!.id)).toBeUndefined();
    expect(await metricsRow(po!.id)).toMatchObject({ state: "updating" });
    const calls = (await fake.callCounts()).insights;
    await run(addMin(NOON, 5));
    expect((await fake.callCounts()).insights).toBe(calls);
  });

  it("認証のエラーなら要再接続にする", async () => {
    const { accountId, threadsUserId } = await growerAccount("u1");
    await markCatchupDone(TODAY);
    await publishedDrafts(accountId, [{ publishedAt: hoursAgo(24) }]);
    await fake.insightsFail(`user:${threadsUserId}`, "auth", -1);
    await run(NOON);
    const [acc] = (await db()`SELECT connection_status FROM accounts WHERE id = ${accountId}`) as [
      { connection_status: string },
    ];
    expect(acc.connection_status).toBe("needs_reconnect");
  });

  it("上限ならその回の反応数の段階を止め、次の回に続ける。一時的な失敗は記録しない", async () => {
    const { accountId } = await growerAccount("u1");
    await markCatchupDone(TODAY);
    const [a, b] = await publishedDrafts(accountId, [{ publishedAt: hoursAgo(24) }, { publishedAt: hoursAgo(24.2) }]);
    await fake.insightsFail("*", "rate_limit", 1);
    await run(NOON);
    expect(await metricsRow(a!.id)).toBeUndefined();
    expect(await metricsRow(b!.id)).toBeUndefined();
    const gate = JSON.parse((await testEnv.AUTOPOST_KV.get("autopost:gate"))!) as { nextCheckAt: string };
    expect(gate.nextCheckAt).toBe(NOON.toISOString());

    await fake.insightsFail(a!.mediaId!, "transient", 1);
    await run(addMin(NOON, 5));
    expect(await metricsRow(a!.id)).toBeUndefined();
    expect(await metricsRow(b!.id)).toMatchObject({ state: "updating" });
  });
});

describe("対象のAccount（FR-005）", () => {
  it("要再接続・grower機能を使えないAccountは取り込まない", async () => {
    const recon = await growerAccount("u1");
    const trial = await connectedAccount("u2", app);
    await db()`UPDATE accounts SET connection_status = 'needs_reconnect' WHERE id = ${recon.accountId}`;
    await db()`UPDATE users SET created_at = ${AFTER_TRIAL().toISOString()} WHERE clerk_user_id = 'u2'`; // 念のため
    await publishedDrafts(recon.accountId, [{ publishedAt: hoursAgo(24) }]);
    await publishedDrafts(trial.accountId, [{ publishedAt: hoursAgo(24) }]);
    await run(NOON);
    expect(await fake.callCounts()).toMatchObject({ insights: 0, followers: 0 });
  });
});

describe("1回の処理の呼び出しの数（research.md R3）", () => {
  it("公開のない回では、Threadsへの呼び出しが24回以下、外部への呼び出しの合計が50回以下", async () => {
    const { accountId } = await growerAccount("u1");
    await markCatchupDone(TODAY);
    await publishedDrafts(accountId, Array.from({ length: 40 }, () => ({ publishedAt: hoursAgo(24) })));
    const spy = vi.spyOn(globalThis, "fetch");
    await run(NOON);
    expect((await fake.callCounts()).insights).toBe(24);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(50);
  });

  it("公開を4件進めた回では、反応数の段階を次の回に回す", async () => {
    for (const u of ["p1", "p2", "p3", "p4"]) {
      const { accountId } = await growerAccount(u);
      await approvedDrafts(accountId, [`${u}本文`]);
      await setSchedule(accountId, { slotMinutes: [720] });
      await publishedDrafts(accountId, [{ publishedAt: hoursAgo(24, addMin(NOON, 1)) }]);
    }
    await markCatchupDone(TODAY);
    await run(addMin(NOON, 1));
    expect(await fake.posts()).toHaveLength(4);
    expect((await fake.callCounts()).insights).toBe(0);
    const gate = JSON.parse((await testEnv.AUTOPOST_KV.get("autopost:gate"))!) as { nextCheckAt: string };
    expect(gate.nextCheckAt).toBe(addMin(NOON, 1).toISOString());
  });
});
