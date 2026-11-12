// 投稿のプロンプトに入る参考投稿の並び（specs/014-strategy-guidance FR-099、research.md R6）。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

/** 今日（日本時間）から days 日前の日付。 */
function daysAgo(days: number) {
  return new Date(Date.now() + 9 * 3600_000 - days * 86_400_000).toISOString().slice(0, 10);
}

describe("投稿のプロンプトの参考投稿", () => {
  it("最新 → 現役 → 投稿日不明 → アーカイブ、同じ区分は登録の新しい順で、10件まで入る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const q = neon(testEnv.DATABASE_URL);
    const insert = (body: string, mode: string, date: string | null, minutesAgo: number) =>
      q`INSERT INTO threads.reference_posts (account_id, body, posted_date_mode, posted_date, created_at)
        VALUES (${accountId}, ${body}, ${mode}, ${date}, now() - make_interval(mins => ${minutesAgo}))`;
    await insert("アーカイブの投稿", "exact", daysAgo(200), 1);
    await insert("不明の古い投稿", "unknown", null, 30);
    await insert("最新の古い投稿", "exact", daysAgo(3), 20);
    await insert("現役の投稿", "exact", daysAgo(60), 2);
    await insert("最新の新しい投稿", "week", null, 5);
    await insert("不明の新しい投稿", "unknown", null, 10);
    for (let i = 0; i < 6; i++) await insert(`埋める投稿${i}`, "unknown", null, 100 + i);

    const res = await call(app, "GET", `/api/accounts/${accountId}/prompt?count=10`, { user: "u1" });
    expect(res.status).toBe(200);
    const { prompt, summary } = (await res.json()) as { prompt: string; summary: { referencePostCount: number } };
    expect(summary.referencePostCount).toBe(10);
    const order = ["最新の新しい投稿", "最新の古い投稿", "現役の投稿", "不明の新しい投稿", "不明の古い投稿"].map((b) =>
      prompt.indexOf(b),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // 投稿日不明が10件を埋めるので、アーカイブは入らない
    expect(prompt).not.toContain("アーカイブの投稿");
  });
});
