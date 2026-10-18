// 0015_strategy_guidance のテスト（specs/014-strategy-guidance data-model.md「マイグレーションの確かめ」）。
// 今の課題・参考投稿・アカウントを入れてから0015を当て、件数と今の値が変わらず、
// 新しい列に既定値が入り、CHECKが効くことを確かめる。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
let accountId: string;
let postId: string;

const COUNTED = ["accounts", "strategy_designs", "reference_posts"] as const;

async function counts() {
  const out: Record<string, number> = {};
  for (const t of COUNTED) {
    const { rows } = await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${t}`);
    out[t] = Number(rows[0]!.n);
  }
  return out;
}

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await client.query(sql, params);
  return rows[0] as T;
}

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0015") - 1);
  const account = await one<{ id: string }>(
    `INSERT INTO accounts (name, connection_status, connection_method) VALUES ('カフェ', 'not_connected', NULL) RETURNING id`,
  );
  accountId = account.id;
  await client.query(
    `INSERT INTO strategy_designs (account_id, final_action, target_persona) VALUES ($1, '公式LINEに登録', '28歳前後の会社員')`,
    [accountId],
  );
  const post = await one<{ id: string }>(
    `INSERT INTO reference_posts (account_id, body, keyword, why_good) VALUES ($1, '大人の友達って、どこで作ってる？', '社会人 友達', '問いかけで終わる') RETURNING id`,
    [accountId],
  );
  postId = post.id;
});

afterAll(async () => {
  await drop?.();
});

describe("0015_strategy_guidance", () => {
  it("件数と今の値が変わらず、新しい列に既定値が入る", async () => {
    const before = await counts();
    await applyMigrations(client, migrationIndex("0015"), migrationIndex("0015"));
    expect(await counts()).toEqual(before);

    const s = await one<Record<string, string | null>>(
      `SELECT final_action, target_persona, purpose_origin, purpose_self, purpose_others, purpose_future, purpose_stance, activity_axis
       FROM strategy_designs WHERE account_id = $1`,
      [accountId],
    );
    expect(s).toEqual({
      final_action: "公式LINEに登録",
      target_persona: "28歳前後の会社員",
      purpose_origin: null,
      purpose_self: null,
      purpose_others: null,
      purpose_future: null,
      purpose_stance: null,
      activity_axis: null,
    });

    const p = await one<Record<string, unknown>>(
      `SELECT body, keyword, why_good, platform, posted_date_mode, posted_date, metric_likes, metric_followers, author, memo
       FROM reference_posts WHERE id = $1`,
      [postId],
    );
    expect(p).toEqual({
      body: "大人の友達って、どこで作ってる？",
      keyword: "社会人 友達",
      why_good: "問いかけで終わる",
      platform: "threads",
      posted_date_mode: "unknown",
      posted_date: null,
      metric_likes: null,
      metric_followers: null,
      author: null,
      memo: null,
    });

    const a = await one<Record<string, number>>(
      `SELECT post_length_target, short_length, medium_length, long_length, short_ratio, medium_ratio, long_ratio
       FROM accounts WHERE id = $1`,
      [accountId],
    );
    expect(a).toEqual({
      post_length_target: 150,
      short_length: 55,
      medium_length: 100,
      long_length: 135,
      short_ratio: 35,
      medium_ratio: 45,
      long_ratio: 20,
    });
  });

  it.each([
    ["割合の合計が100でない", `UPDATE accounts SET short_ratio = 40 WHERE id = $1`],
    ["長さが目標を超える", `UPDATE accounts SET long_length = 160 WHERE id = $1`],
    ["目標が範囲の外", `UPDATE accounts SET post_length_target = 40, short_length = 10, medium_length = 10, long_length = 10 WHERE id = $1`],
  ])("accounts の CHECK：%s", async (_label, sql) => {
    await expect(client.query(sql, [accountId])).rejects.toThrow(/accounts_/);
  });

  it.each([
    ["媒体が一覧にない", `UPDATE reference_posts SET platform = 'facebook' WHERE id = $1`],
    ["選び方が一覧にない", `UPDATE reference_posts SET posted_date_mode = 'year' WHERE id = $1`],
    ["exact で投稿日がない", `UPDATE reference_posts SET posted_date_mode = 'exact', posted_date = NULL WHERE id = $1`],
    ["exact 以外で投稿日がある", `UPDATE reference_posts SET posted_date_mode = 'week', posted_date = '2026-10-01' WHERE id = $1`],
    ["数字が負", `UPDATE reference_posts SET metric_views = -1 WHERE id = $1`],
    ["投稿者が101文字", `UPDATE reference_posts SET author = repeat('あ', 101) WHERE id = $1`],
    ["メモが501文字", `UPDATE reference_posts SET memo = repeat('あ', 501) WHERE id = $1`],
  ])("reference_posts の CHECK：%s", async (_label, sql) => {
    await expect(client.query(sql, [postId])).rejects.toThrow(/reference_posts_/);
  });

  it("exact と投稿日の組、数字0、投稿者100文字は入る", async () => {
    await client.query(
      `UPDATE reference_posts SET posted_date_mode = 'exact', posted_date = '2026-10-10', metric_views = 0, author = repeat('あ', 100) WHERE id = $1`,
      [postId],
    );
    const p = await one<{ posted_date_mode: string }>(`SELECT posted_date_mode FROM reference_posts WHERE id = $1`, [postId]);
    expect(p.posted_date_mode).toBe("exact");
  });
});
