// 自動投稿の結合テストの共通部品（specs/005-auto-post）：接続済みのAccount、承認済みの下書き、投稿の設定、定期処理の実行
import { neon } from "@neondatabase/serverless";
import { createDb } from "../../src/kernel/db/client";
import { runAutoPost } from "../../src/services/auto-post-runner";
import { call, connectNew, fake, makeApp, testEnv, type TestApp } from "./app";

const sql = () => {
  createDb(testEnv.DATABASE_URL); // ローカルプロキシの設定を有効にする
  return neon(testEnv.DATABASE_URL);
};

/** 日本時間の日時（"2030-01-10 12:00"）を Date にする。 */
export const jst = (s: string) => new Date(`${s.replace(" ", "T")}:00+09:00`);

/** 分を足した日時。 */
export const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

/** 日時の、日本時間の0時からの分。 */
export const jstMinuteOf = (d: Date) =>
  Math.floor(((d.getTime() + 9 * 3600_000) % 86_400_000) / 60_000);

let fakeSeq = 0;

/**
 * 偽のThreadsで接続した Account を作る（トークンは暗号化して保存される）。
 * @param user - Clerk のユーザーID（"u1" など）
 * @param app - テスト用のアプリ
 * @returns accountId と、ThreadsのユーザーID
 */
export async function connectedAccount(user: string, app: TestApp = makeApp()) {
  fakeSeq += 1;
  const threadsUserId = String(9100 + fakeSeq);
  await fake.addUser(threadsUserId, `${user}_${fakeSeq}`);
  const { callbackRes } = await connectNew(app, user, threadsUserId);
  if (callbackRes?.status !== 302) throw new Error("connect failed");
  const [row] = (await sql()`SELECT id FROM accounts WHERE threads_user_id = ${threadsUserId}`) as [
    { id: string },
  ];
  return { accountId: row.id, threadsUserId };
}

/**
 * 承認済みの下書きを、配列の順に承認した（古い順）ものとして作る。
 * @param accountId - accounts.id
 * @param bodies - 本文
 * @returns 下書きのID（配列の順）
 */
export async function approvedDrafts(accountId: string, bodies: string[]): Promise<string[]> {
  const db = sql();
  const [b] = (await db`
    INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found)
    VALUES (${accountId}, gen_random_uuid(), ${bodies.length}, true) RETURNING id`) as [
    { id: string },
  ];
  const ids: string[] = [];
  for (const [i, body] of bodies.entries()) {
    const [d] = (await db`
      INSERT INTO post_drafts (account_id, batch_id, position, body, status, reviewed_at)
      VALUES (${accountId}, ${b.id}, ${i}, ${body}, 'approved', now() - make_interval(secs => ${bodies.length - i}))
      RETURNING id`) as [{ id: string }];
    ids.push(d.id);
  }
  return ids;
}

/**
 * 投稿の設定を直接入れる（effective_from は既定で遠い過去）。
 * @param accountId - accounts.id
 * @param s - 時刻（0時からの分）・オン・ずらす・effective_from
 */
export async function setSchedule(
  accountId: string,
  s: {
    slotMinutes: number[];
    enabled?: boolean;
    jitter?: boolean;
    effectiveFrom?: Date;
    pausedUntil?: Date | null;
  },
) {
  const db = sql();
  const effectiveFrom = (s.effectiveFrom ?? new Date("2000-01-01T00:00:00Z")).toISOString();
  const pausedUntil = s.pausedUntil ? s.pausedUntil.toISOString() : null;
  await db`
    INSERT INTO posting_schedules (account_id, enabled, slot_minutes, jitter, effective_from, paused_until)
    VALUES (${accountId}, ${s.enabled ?? true}, ${s.slotMinutes}, ${s.jitter ?? false}, ${effectiveFrom}, ${pausedUntil})
    ON CONFLICT (account_id) DO UPDATE SET enabled = EXCLUDED.enabled, slot_minutes = EXCLUDED.slot_minutes,
      jitter = EXCLUDED.jitter, effective_from = EXCLUDED.effective_from, paused_until = EXCLUDED.paused_until`;
}

/**
 * 定期処理を1回動かす。既定では関所を消してから動かす（関所のテストは keepGate: true）。
 * 実際の時刻（投稿日時の記録）は、既定では now にそろえる（clock で変えられる）。
 */
export async function run(now: Date, opts: { keepGate?: boolean; clock?: () => Date } = {}) {
  if (!opts.keepGate) await testEnv.AUTOPOST_KV.delete("autopost:gate");
  return runAutoPost(testEnv, now, undefined, opts.clock ?? (() => now));
}

/** 下書きの行。 */
export async function draftRow(id: string) {
  const [r] = (await sql()`SELECT * FROM post_drafts WHERE id = ${id}`) as [
    Record<string, unknown>,
  ];
  return r;
}

/** その Account の試みの行（予定の時刻の順）。 */
export async function attempts(accountId: string) {
  return (await sql()`SELECT * FROM publish_attempts WHERE account_id = ${accountId} ORDER BY slot_at, created_at`) as Record<
    string,
    unknown
  >[];
}

/** 任意のSQL（テストの準備用）。 */
export const db = sql;

/** 投稿のスケジュールのAPIを呼ぶ（テスト用の短縮）。 */
export function putSchedule(app: TestApp, accountId: string, body: unknown, user = "u1") {
  return call(app, "PUT", `/api/accounts/${accountId}/posting-schedule`, { user, body });
}

// ---- 反応数（specs/006-performance-feedback）----

let mediaSeq = 0;

/**
 * 投稿済みの下書きを、投稿した日時を指定して作る（Threadsの投稿IDは既定で新しく振る。null なら投稿IDなし）。
 * @param accountId - accounts.id
 * @param items - 本文・投稿した日時・投稿ID
 * @returns 下書きのIDと投稿ID（配列の順）
 */
export async function publishedDrafts(
  accountId: string,
  items: { body?: string; publishedAt: Date; mediaId?: string | null }[],
): Promise<{ id: string; mediaId: string | null }[]> {
  const db = sql();
  const [b] = (await db`
    INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found)
    VALUES (${accountId}, gen_random_uuid(), ${items.length}, true) RETURNING id`) as [{ id: string }];
  const out: { id: string; mediaId: string | null }[] = [];
  for (const [i, it] of items.entries()) {
    mediaSeq += 1;
    const mediaId = it.mediaId === undefined ? String(18_000_000_000 + mediaSeq) : it.mediaId;
    const permalink = mediaId ? `https://www.threads.com/@x/post/${mediaId}` : null;
    const [d] = (await db`
      INSERT INTO post_drafts (account_id, batch_id, position, body, status, reviewed_at, published_at, threads_media_id, threads_permalink)
      VALUES (${accountId}, ${b.id}, ${i}, ${it.body ?? `投稿${mediaSeq}`}, 'published', ${it.publishedAt.toISOString()},
        ${it.publishedAt.toISOString()}, ${mediaId}, ${permalink})
      RETURNING id`) as [{ id: string }];
    out.push({ id: d.id, mediaId });
  }
  return out;
}

/** 反応数の記録の行（なければ undefined）。 */
export async function metricsRow(draftId: string) {
  const [r] = (await sql()`SELECT * FROM post_metrics WHERE draft_id = ${draftId}`) as Record<string, unknown>[];
  return r;
}

/** 取り込みの履歴（取り込んだ順）。 */
export async function snapshotsOf(draftId: string) {
  return (await sql()`SELECT * FROM post_metric_snapshots WHERE draft_id = ${draftId} ORDER BY fetched_at, kind`) as Record<
    string,
    unknown
  >[];
}

/**
 * 確定した反応数の記録を直接作る（判定の準備用）。
 * @param accountId - accounts.id
 * @param draftId - post_drafts.id
 * @param views - 閲覧数
 * @param state - confirmed か late_confirmed
 */
export async function confirmedMetrics(
  accountId: string,
  draftId: string,
  views: number | null,
  state: "confirmed" | "late_confirmed" = "confirmed",
) {
  await sql()`
    INSERT INTO post_metrics (draft_id, account_id, state, views, likes, replies, reposts, quotes, shares,
      last_fetched_at, last_elapsed_minutes, last_kind, confirmed_at)
    VALUES (${draftId}, ${accountId}, ${state}, ${views}, 0, 0, 0, 0, 0, now(), 10080,
      ${state === "confirmed" ? "d7" : "late"}, now())`;
}

/** その日の補い（毎日の処理）を済んだことにする（時点の取り込みだけを確かめるとき）。 */
export async function markCatchupDone(jstDate: string) {
  await testEnv.AUTOPOST_KV.put("metrics:catchup", jstDate);
}

/** 補いの印を消す。 */
export async function clearCatchup() {
  await testEnv.AUTOPOST_KV.delete("metrics:catchup");
}
