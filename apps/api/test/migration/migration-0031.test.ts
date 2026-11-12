// 0031_drop_old_limit_columns のテスト（specs/meguru/029-threads-pattern1 tasks.md T060）。
// 上限の古い列と「最後に開いたアカウント」の古い列、operator_settings を消す。新しい表にない値だけを写してから消す（上書きしない）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
const ids: Record<string, string> = {};

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0031") - 1);
  const user = async (name: string) =>
    (await client.query<{ id: string }>(`INSERT INTO users (clerk_user_id, email) VALUES ($1, $2) RETURNING id`, [name, `${name}@example.com`])).rows[0]!.id;
  ids.u1 = await user("u1");
  ids.u2 = await user("u2");
  // 新しい表にもう値がある（両方に書いてきた）：上書きしない
  await client.query(`INSERT INTO operator_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  await client.query(`UPDATE operator_settings SET default_account_limit = 4, default_daily_post_limit = 12 WHERE id = 1`);
  await client.query(`DELETE FROM app_limit_defaults`);
  await client.query(`INSERT INTO app_limit_defaults (app, key, value) VALUES ('threads', 'accounts', 5)`);
  await client.query(`UPDATE users SET account_limit = 2, daily_post_limit = 8 WHERE id = $1`, [ids.u1]);
  await client.query(`INSERT INTO user_app_limits (user_id, app, key, value) VALUES ($1, 'threads', 'accounts', 3)`, [ids.u1]);
  await applyMigrations(client, migrationIndex("0031"), migrationIndex("0031"));
});

afterAll(async () => {
  await drop?.();
});

describe("0031_drop_old_limit_columns", () => {
  it("新しい表にない値だけを写し、ある値は上書きしない", async () => {
    const defaults = await client.query(`SELECT key, value FROM app_limit_defaults WHERE app = 'threads' ORDER BY key`);
    expect(defaults.rows).toEqual([
      { key: "accounts", value: 5 },
      { key: "daily_posts", value: 12 },
    ]);
    const limits = await client.query(`SELECT user_id, key, value FROM user_app_limits ORDER BY user_id, key`);
    expect(limits.rows).toEqual([
      { user_id: ids.u1, key: "accounts", value: 3 },
      { user_id: ids.u1, key: "daily_posts", value: 8 },
    ]);
  });

  it("古い列と operator_settings がない", async () => {
    const cols = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'
         AND (column_name LIKE 'last_account%' OR column_name IN ('account_limit', 'daily_post_limit'))`,
    );
    expect(cols.rows).toEqual([]);
    const table = await client.query(`SELECT to_regclass('public.operator_settings') AS t`);
    expect(table.rows[0].t).toBeNull();
  });
});
