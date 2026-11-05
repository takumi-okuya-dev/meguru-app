// アルゴリズムの解析のAPI（specs/022-algorithm-analysis contracts/api.md、tasks.md T007・T013・T021・T028・T035）
import { neon } from "@neondatabase/serverless";
import type { AnalysisResponse, ClassificationsResponse } from "@threads-grower/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, endTrial, makeApp, resetDb, testEnv } from "../helpers/app";
import { publishedDrafts } from "../helpers/auto-post";
import { disableFeatures } from "../helpers/features";
import { activityRows, putInTeam } from "../helpers/team";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);
const DAY = 86_400_000;
const HOURS = [7, 12, 17, 21];

async function json<T>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error;
const base = (accountId: string) => `/api/accounts/${accountId}`;

/**
 * 日本時間の「今日からdays日前のhour時」。
 * @param days - 何日前
 * @param hour - 時（日本時間）
 * @returns 日時
 */
function jstAgo(days: number, hour: number): Date {
  const ymd = new Date(Date.now() + 9 * 3600_000 - days * DAY).toISOString().slice(0, 10);
  return new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00+09:00`);
}

type Seed = {
  body?: string;
  publishedAt?: Date;
  views?: number;
  replies?: number;
  state?: "confirmed" | "late_confirmed" | "unmeasurable" | "updating";
  h24?: number | null;
};

/**
 * 投稿と反応数を入れる。既定は夜（21時）の閲覧が高い形（1日1件、hour は 7・12・17・21 の順）。
 * @param accountId - accounts.id
 * @param n - 件数
 * @param over - 投稿ごとに変えるところ
 * @returns post_drafts.id（入れた順）
 */
async function seed(accountId: string, n: number, over: (i: number) => Seed = () => ({})): Promise<string[]> {
  const items = Array.from({ length: n }, (_, i) => {
    const hour = HOURS[i % HOURS.length]!;
    return { i, hour, ...{ body: `投稿${i}の本文`, publishedAt: jstAgo(i + 8, hour), views: hour === 21 ? 400 : 200, h24: 100 }, ...over(i) };
  });
  const drafts: { id: string }[] = [];
  // 1つのまとまりは50件まで（draft_batches の CHECK）
  for (let k = 0; k < items.length; k += 50)
    drafts.push(...(await publishedDrafts(accountId, items.slice(k, k + 50).map((it) => ({ body: it.body, publishedAt: it.publishedAt })))));
  for (const [k, it] of items.entries()) {
    const id = drafts[k]!.id;
    const state = it.state ?? "confirmed";
    if (state === "unmeasurable") {
      await sql()`INSERT INTO post_metrics (draft_id, account_id, state, unmeasurable_reason) VALUES (${id}, ${accountId}, 'unmeasurable', 'no_media_id')`;
      continue;
    }
    const confirmed = state === "confirmed" || state === "late_confirmed";
    await sql()`INSERT INTO post_metrics (draft_id, account_id, state, views, likes, replies, reposts, quotes, shares,
        last_fetched_at, last_elapsed_minutes, last_kind, confirmed_at)
      VALUES (${id}, ${accountId}, ${state}, ${it.views}, 5, ${it.replies ?? 1}, 0, 0, 0, now(), 10080,
        ${state === "confirmed" ? "d7" : state === "late_confirmed" ? "late" : "h24"}, ${confirmed ? new Date().toISOString() : null})`;
    if (it.h24 !== null)
      await sql()`INSERT INTO post_metric_snapshots (draft_id, account_id, kind, method, fetched_at, elapsed_minutes, views)
        VALUES (${id}, ${accountId}, 'h24', 'slot', ${new Date(it.publishedAt.getTime() + DAY).toISOString()}, 1440, ${it.h24})`;
  }
  return drafts.map((d) => d.id);
}

/**
 * フォロワー数の記録を入れる（その日時以後の投稿の「投稿時点のフォロワー数」になる）。
 * @param accountId - accounts.id
 * @param count - フォロワー数
 * @param at - 記録した日時
 */
async function followers(accountId: string, count: number, at: Date) {
  await sql()`INSERT INTO follower_snapshots (account_id, snapshot_date, followers_count, captured_at)
    VALUES (${accountId}, ${at.toISOString().slice(0, 10)}, ${count}, ${at.toISOString()})`;
}

const getAnalysis = async (accountId: string, query = "", user = "u1") =>
  json<AnalysisResponse>(await call(app, "GET", `${base(accountId)}/analysis${query}`, { user }));
const patchSettings = (accountId: string, body: Record<string, unknown>, user = "u1") =>
  call(app, "PATCH", `${base(accountId)}/analysis/settings`, { user, body });

beforeEach(async () => {
  await resetDb();
});

describe("守り（T007）", () => {
  it("オーナーと担当の人は読める。見せてもらっている人は ROLE_FORBIDDEN、関わりのない人は ACCOUNT_NOT_FOUND（SC-005）", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { editor: "e1", shared: true });
    await createUserWithAccount("x1");
    expect((await call(app, "GET", `${base(accountId)}/analysis`, { user: "o1" })).status).toBe(200);
    expect((await call(app, "GET", `${base(accountId)}/analysis`, { user: "e1" })).status).toBe(200);
    const viewer = await call(app, "GET", `${base(accountId)}/analysis`, { user: "a1" });
    expect([viewer.status, (await errorOf(viewer)).code]).toEqual([403, "ROLE_FORBIDDEN"]);
    const stranger = await call(app, "GET", `${base(accountId)}/analysis`, { user: "x1" });
    expect([stranger.status, (await errorOf(stranger)).code]).toEqual([404, "ACCOUNT_NOT_FOUND"]);
  });

  it("自動投稿がOFFなら FEATURE_DISABLED、決済で読むだけなら書けない、scope が違うと VALIDATION_FAILED", async () => {
    const { userId, accountId } = await createUserWithAccount("u1");
    const bad = await call(app, "GET", `${base(accountId)}/analysis?scope=promo`, { user: "u1" });
    expect([bad.status, (await errorOf(bad)).code]).toEqual([400, "VALIDATION_FAILED"]);
    await endTrial(userId);
    const billing = await call(app, "PATCH", `${base(accountId)}/analysis/settings`, {
      user: "u1",
      body: { expectedVersion: null, trendsInPrompt: false },
      env: { ...testEnv, BILLING_ENABLED: "true" } as typeof testEnv,
    });
    expect([billing.status, (await errorOf(billing)).code]).toEqual([403, "BILLING_REQUIRED"]);
    await disableFeatures(userId, "autopost");
    for (const [method, path] of [
      ["GET", "/analysis"],
      ["GET", "/analysis/classifications"],
    ] as const) {
      const off = await call(app, method, `${base(accountId)}${path}`, { user: "u1" });
      expect([off.status, (await errorOf(off)).code]).toEqual([403, "FEATURE_DISABLED"]);
    }
  });
});

describe("解析の画面（T013・T021）", () => {
  it("期間の確定した投稿だけを使い、夜の傾向が出る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await seed(accountId, 40);
    // 使わない投稿：遅れて確定・計測できない・確定待ち・91日前
    await seed(accountId, 4, (i) => ({
      state: (["late_confirmed", "unmeasurable", "updating", "confirmed"] as const)[i],
      publishedAt: i === 3 ? jstAgo(90, 12) : jstAgo(3, 12),
      views: 9999,
    }));
    const r = await getAnalysis(accountId);
    expect(r.totals.confirmed).toBe(40);
    expect(r.needMore).toBeNull();
    expect(r.period.days).toBe(90);
    expect(r.time.find((b) => b.key === "night")).toMatchObject({ count: 10, views: 400 });
    expect(r.trends[0]).toMatchObject({ dimension: "time", key: "night", text: "夜（20〜23時）に出した投稿が伸びやすい", count: 10 });
    expect(r.schedule.slotTimes).toEqual([]);
    expect(r.settings).toEqual({ trendsInPrompt: true, themes: [], version: null });
    expect(r.canEdit).toBe(true);
  });

  it("投稿がなければ needMore が20。ほかのAccountの投稿は入らない", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const { accountId: other } = await createUserWithAccount("u2");
    await seed(other, 30);
    const r = await getAnalysis(accountId);
    expect(r.needMore).toBe(20);
    expect(r.totals.confirmed).toBe(0);
  });

  it("scope=regular で宣伝の投稿（本文に宣伝内容のタイトル・URL）が外れる", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await call(app, "POST", `${base(accountId)}/promotions`, {
      user: "u1",
      body: { title: "春の交流会", content: "案内", linkedUrl: "https://example.com/e/1" },
    });
    await seed(accountId, 30, (i) => (i < 3 ? { body: `春の交流会のお知らせ${i}` } : i < 5 ? { body: `申込は https://example.com/e/1 から${i}` } : {}));
    const all = await getAnalysis(accountId);
    expect(all.totals).toMatchObject({ confirmed: 30, promo: 5 });
    const regular = await getAnalysis(accountId, "?scope=regular");
    expect(regular.scope).toBe("regular");
    expect(regular.totals).toMatchObject({ confirmed: 25, promo: 5 });
  });

  it("おすすめに乗った目安：投稿時点のフォロワー数で広がりを求め、本文は初めの40文字だけ返す", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await followers(accountId, 100, jstAgo(80, 0));
    const ids = await seed(accountId, 30, (i) => ({ views: i < 5 ? 500 : 80, body: `${"あ".repeat(50)}${i}`, h24: i < 5 ? 250 : 60 }));
    const r = await getAnalysis(accountId);
    expect(r.totals.withFollowers).toBe(30);
    expect(r.recommended.available).toBe(true);
    expect(r.recommended.posts.map((p) => p.id).sort()).toEqual(ids.slice(0, 5).sort());
    expect(r.recommended.posts[0]).toMatchObject({ views: 500, spread: 5, firstSpeed: 250, laterGrowth: 2, head: "あ".repeat(40) });
    expect(r.recommended.compare).toMatchObject({ recommended: { count: 5 }, others: { count: 25, firstSpeed: 60 } });
    expect(JSON.stringify(r)).not.toContain("あ".repeat(41));
  });
});

describe("設定とプロンプト（T028）", () => {
  it("切り替えの保存・衝突・操作の記録", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { editor: "e1" });
    const first = await json<{ settings: { trendsInPrompt: boolean; version: number } }>(
      await patchSettings(accountId, { expectedVersion: null, trendsInPrompt: false }, "e1"),
    );
    expect(first.settings).toEqual({ trendsInPrompt: false, themes: [], version: 1 });
    const stale = await patchSettings(accountId, { expectedVersion: null, trendsInPrompt: true }, "o1");
    expect([stale.status, (await errorOf(stale)).code]).toEqual([409, "STALE_UPDATE"]);
    const second = await json<{ settings: { version: number } }>(await patchSettings(accountId, { expectedVersion: 1, trendsInPrompt: true }, "o1"));
    expect(second.settings.version).toBe(2);
    expect((await activityRows(accountId)).map((r) => r.action)).toContain("analysis_settings_updated");
  });

  it("プロンプトに「■伸びた傾向」が入り、切り替えをOFFにすると入らない", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await seed(accountId, 40, (i) => (i % 2 === 0 ? { body: `投稿${i}\nどう思う？`, views: 600 } : { body: `こうしてる${i}`, views: 200 }));
    const on = await json<{ prompt: string; summary: { trendCount: number } }>(await call(app, "GET", `${base(accountId)}/prompt`, { user: "u1" }));
    expect(on.prompt).toContain("■伸びた傾向(取りためた反応数から見た傾向。合わせすぎず、人柄とCORE RULESを優先すること)");
    expect(on.prompt).toContain("・最後に問いかけがある投稿が伸びやすい(20件。閲覧の中央値が、ほかの投稿の3.0倍)");
    expect(on.prompt).not.toContain("時)に出した投稿");
    expect(on.summary.trendCount).toBeGreaterThan(0);
    await patchSettings(accountId, { expectedVersion: null, trendsInPrompt: false });
    const off = await json<{ prompt: string; summary: { trendCount: number } }>(await call(app, "GET", `${base(accountId)}/prompt`, { user: "u1" }));
    expect(off.prompt).not.toContain("■伸びた傾向");
    expect(off.summary.trendCount).toBe(0);
  });

  it("プロンプトの傾向はふだんの投稿で求める（宣伝の投稿の閲覧が高くても傾向にならない）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await call(app, "POST", `${base(accountId)}/promotions`, { user: "u1", body: { title: "春の交流会", content: "案内" } });
    await seed(accountId, 40, (i) => (i % 2 === 0 ? { body: `春の交流会${i}\nどう思う？`, views: 600 } : { body: `こうしてる${i}`, views: 200 }));
    const r = await json<{ prompt: string }>(await call(app, "GET", `${base(accountId)}/prompt`, { user: "u1" }));
    expect(r.prompt).not.toContain("■伸びた傾向");
  });
});

describe("内容の分類（T035）", () => {
  it("まだの投稿を50件まで返し、保存・入れ替え・ほかのAccountの投稿は skipped", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const { accountId: other } = await createUserWithAccount("u2");
    const ids = await seed(accountId, 55);
    const [otherId] = await seed(other, 1);
    const list = await json<ClassificationsResponse>(await call(app, "GET", `${base(accountId)}/analysis/classifications`, { user: "u1" }));
    expect(list.posts.length).toBe(50);
    expect(list.remaining).toBe(5);
    expect(list.posts[0]!.draftId).toBe(ids[0]); // 新しい順
    const put = (body: Record<string, unknown>) => call(app, "PUT", `${base(accountId)}/analysis/classifications`, { user: "u1", body });
    const saved = await json<{ saved: number; skipped: string[] }>(
      await put({
        source: "ai",
        items: [
          { draftId: ids[0], openingType: "aruaru", themeId: null },
          { draftId: ids[1], openingType: "story", themeId: "t9" },
          { draftId: otherId, openingType: "story", themeId: null },
        ],
      }),
    );
    expect(saved).toEqual({ saved: 1, skipped: [ids[1], otherId] });
    await put({ source: "manual", items: [{ draftId: ids[0], openingType: "question", themeId: null }] });
    const [row] = (await sql()`SELECT opening_type, source FROM post_classifications WHERE draft_id = ${ids[0]}`) as { opening_type: string; source: string }[];
    expect(row).toEqual({ opening_type: "question", source: "manual" });
    const classified = await json<ClassificationsResponse>(
      await call(app, "GET", `${base(accountId)}/analysis/classifications?mode=classified`, { user: "u1" }),
    );
    expect(classified.posts.map((p) => [p.draftId, p.openingType])).toEqual([[ids[0], "question"]]);
    expect((await getAnalysis(accountId)).totals.classified).toBe(1);
  });

  it("テーマ：新しいidが付き、消したテーマの分類はテーマなしになる。重なりは VALIDATION_FAILED", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [id] = await seed(accountId, 1);
    const res = await json<{ settings: { themes: { id: string; name: string }[]; version: number } }>(
      await patchSettings(accountId, { expectedVersion: null, themes: [{ name: "転職" }, { name: "働き方" }] }),
    );
    const [t1, t2] = res.settings.themes;
    expect(t1!.id).toMatch(/^t[0-9a-z]{1,8}$/);
    await call(app, "PUT", `${base(accountId)}/analysis/classifications`, {
      user: "u1",
      body: { source: "ai", items: [{ draftId: id, openingType: "story", themeId: t1!.id }] },
    });
    const dup = await patchSettings(accountId, { expectedVersion: 1, themes: [{ name: "a" }, { name: "a" }] });
    expect([dup.status, (await errorOf(dup)).code]).toEqual([400, "VALIDATION_FAILED"]);
    const kept = await json<{ settings: { themes: { id: string; name: string }[] } }>(
      await patchSettings(accountId, { expectedVersion: 1, themes: [{ id: t2!.id, name: "働き方改革" }] }),
    );
    expect(kept.settings.themes).toEqual([{ id: t2!.id, name: "働き方改革" }]);
    const [row] = (await sql()`SELECT theme_id FROM post_classifications WHERE draft_id = ${id}`) as { theme_id: string | null }[];
    expect(row!.theme_id).toBeNull();
  });

  it("投稿を消すと分類も消える", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [id] = await seed(accountId, 1);
    await call(app, "PUT", `${base(accountId)}/analysis/classifications`, {
      user: "u1",
      body: { source: "ai", items: [{ draftId: id, openingType: "story", themeId: null }] },
    });
    await sql()`DELETE FROM post_drafts WHERE id = ${id}`;
    expect(((await sql()`SELECT 1 FROM post_classifications`) as unknown[]).length).toBe(0);
  });
});

describe("時間差のメンションの返信を返信率から除く（specs/023 research.md R7、T035）", () => {
  it("反応数の取り込みより前に出した自分の返信のぶん、返信の数から1を引く", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const ids = await seed(accountId, 20, () => ({ replies: 1 }));
    await sql()`INSERT INTO post_mentions (draft_id, account_id, usernames, text, delay_minutes, state, sent_at)
      SELECT id, account_id, ARRAY['a'], '@a', 30, 'sent', now() - interval '1 day' FROM post_drafts WHERE id = ANY(${ids})`;
    const r = await getAnalysis(accountId);
    expect(r.time.every((b) => b.replyRate === null || b.replyRate === 0)).toBe(true);
  });
});

