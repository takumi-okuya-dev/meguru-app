// 0020_algorithm_analysis のテスト（specs/022-algorithm-analysis data-model.md、T004）。
// 解析の設定と投稿の分類の表を足すだけ。初めの値・CHECK・消したときの cascade を確かめる。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
let accountId: string;
let draftIds: string[];

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0020") - 1);
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
  await applyMigrations(client, migrationIndex("0020"), migrationIndex("0020"));
});

afterAll(async () => {
  await drop?.();
});

const classify = (draftId: string, values: Record<string, unknown> = {}) =>
  client.query(`INSERT INTO post_classifications (draft_id, account_id, opening_type, theme_id, source) VALUES ($1, $2, $3, $4, $5)`, [
    draftId,
    accountId,
    values.openingType ?? "aruaru",
    values.themeId ?? null,
    values.source ?? "ai",
  ]);

describe("0020_algorithm_analysis", () => {
  it("解析の設定の初めの値", async () => {
    await client.query(`INSERT INTO analysis_settings (account_id) VALUES ($1)`, [accountId]);
    const { rows } = await client.query(`SELECT trends_in_prompt, themes, version FROM analysis_settings WHERE account_id = $1`, [accountId]);
    expect(rows[0]).toEqual({ trends_in_prompt: true, themes: [], version: 1 });
  });

  it("書き出しの型・テーマのid・付け方を CHECK で拒む", async () => {
    await expect(classify(draftIds[0]!, { openingType: "joke" })).rejects.toThrow();
    await expect(classify(draftIds[0]!, { themeId: "x1" })).rejects.toThrow();
    await expect(classify(draftIds[0]!, { source: "auto" })).rejects.toThrow();
    await classify(draftIds[0]!, { themeId: "t1" });
    await expect(classify(draftIds[0]!)).rejects.toThrow(); // 主キー（投稿に1行）
    await classify(draftIds[1]!, { source: "manual" });
  });

  it("投稿を消すと分類が、Accountを消すと設定と分類が消える", async () => {
    await client.query(`DELETE FROM post_drafts WHERE id = $1`, [draftIds[0]]);
    expect((await client.query(`SELECT 1 FROM post_classifications`)).rowCount).toBe(1);
    await client.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
    expect((await client.query(`SELECT 1 FROM post_classifications`)).rowCount).toBe(0);
    expect((await client.query(`SELECT 1 FROM analysis_settings`)).rowCount).toBe(0);
  });
});
