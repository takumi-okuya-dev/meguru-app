// 0021_delayed_mention のテスト（specs/023-delayed-mention data-model.md、T004）。
// 表3つと列1つを足すだけ。CHECK と、下書き・Accountを消したときの cascade を確かめる。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
let accountId: string;
let draftIds: string[];

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0021") - 1);
  accountId = (
    await client.query<{ id: string }>(
      `INSERT INTO accounts (name, connection_status, connection_method) VALUES ('店', 'not_connected', NULL) RETURNING id`,
    )
  ).rows[0]!.id;
  const batch = (
    await client.query<{ id: string }>(
      `INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found) VALUES ($1, gen_random_uuid(), 2, true) RETURNING id`,
      [accountId],
    )
  ).rows[0]!;
  draftIds = (
    await client.query<{ id: string }>(
      `INSERT INTO post_drafts (account_id, batch_id, position, body) VALUES ($1, $2, 0, '案1'), ($1, $2, 1, '案2') RETURNING id`,
      [accountId, batch.id],
    )
  ).rows.map((r) => r.id);
  await applyMigrations(client, migrationIndex("0021"), migrationIndex("0021"));
});

afterAll(async () => {
  await drop?.();
});

const mention = (draftId: string, v: Record<string, unknown> = {}) =>
  client.query(
    `INSERT INTO post_mentions (draft_id, account_id, usernames, text, delay_minutes, send_after, state, failure_reason, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      draftId,
      accountId,
      v.usernames ?? ["a"],
      v.text ?? "@a",
      v.delayMinutes === undefined ? 30 : v.delayMinutes,
      v.sendAfter ?? null,
      v.state ?? "pending",
      v.failureReason ?? null,
      v.sentAt ?? null,
    ],
  );

describe("0021_delayed_mention", () => {
  it("今のAccountの replies_denied_at は NULL、設定の初めの値", async () => {
    expect((await client.query(`SELECT replies_denied_at FROM accounts`)).rows[0]!.replies_denied_at).toBeNull();
    await client.query(`INSERT INTO mention_settings (account_id) VALUES ($1)`, [accountId]);
    expect((await client.query(`SELECT message, delay_minutes, version FROM mention_settings`)).rows[0]).toEqual({
      message: "",
      delay_minutes: 30,
      version: 1,
    });
    await expect(client.query(`UPDATE mention_settings SET delay_minutes = 45`)).rejects.toThrow();
  });

  it("メンションする人：ユーザー名の形と、同じ人の重なりを拒む", async () => {
    const add = (u: string) => client.query(`INSERT INTO mention_people (account_id, username, label) VALUES ($1, $2, '呼び名')`, [accountId, u]);
    await expect(add("Bad Name")).rejects.toThrow();
    await add("minato_place");
    await expect(add("minato_place")).rejects.toThrow();
  });

  it("時間差のメンション：状態・理由・時刻・人数の CHECK", async () => {
    await expect(mention(draftIds[0]!, { state: "done" })).rejects.toThrow();
    await expect(mention(draftIds[0]!, { state: "failed" })).rejects.toThrow(); // 理由がない
    await expect(mention(draftIds[0]!, { failureReason: "limit" })).rejects.toThrow(); // pending に理由
    await expect(mention(draftIds[0]!, { state: "sent" })).rejects.toThrow(); // sent_at がない
    await expect(mention(draftIds[0]!, { delayMinutes: null })).rejects.toThrow(); // 時刻がない
    await expect(mention(draftIds[0]!, { usernames: [] })).rejects.toThrow();
    await expect(mention(draftIds[0]!, { usernames: ["a", "b", "c", "d", "e", "f"] })).rejects.toThrow();
    await mention(draftIds[0]!);
    await mention(draftIds[1]!, { delayMinutes: null, sendAfter: new Date().toISOString(), state: "sent", sentAt: new Date().toISOString() });
  });

  it("下書きを消すとメンションが、Accountを消すと全部が消える", async () => {
    await client.query(`DELETE FROM post_drafts WHERE id = $1`, [draftIds[0]]);
    expect((await client.query(`SELECT 1 FROM post_mentions`)).rowCount).toBe(1);
    await client.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
    for (const t of ["post_mentions", "mention_people", "mention_settings"])
      expect((await client.query(`SELECT 1 FROM ${t}`)).rowCount).toBe(0);
  });
});
