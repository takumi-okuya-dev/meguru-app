// 0027_recopy_usage のテスト（specs/meguru/029-threads-pattern1 tasks.md T024、/speckit-analyze G1・U4）。
// 0026 のあとで作った・消したアカウントや、古い列だけに書かれた上限の分のずれを、料金の数を切り替える前に消す。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
const ids: Record<string, string> = {};

/**
 * 持ち主のアカウントを作る。
 * @param userId - users.id
 * @returns accounts.id
 */
async function ownedAccount(userId: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO accounts (name, connection_status, connection_method) VALUES ('店', 'not_connected', NULL) RETURNING id`,
  );
  await client.query(`INSERT INTO memberships (user_id, account_id, role) VALUES ($1, $2, 'owner')`, [userId, rows[0]!.id]);
  return rows[0]!.id;
}

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0027") - 1);
  // 0026 のあとの状態：u1 は記録が1件のまま、アカウントが2件に増えた。u2 は記録が1件のまま、アカウントを消した
  const u1 = await client.query<{ id: string }>(`INSERT INTO users (clerk_user_id, email) VALUES ('u1', 'u1@example.com') RETURNING id`);
  ids.u1 = u1.rows[0]!.id;
  await ownedAccount(ids.u1);
  await ownedAccount(ids.u1);
  await client.query(`INSERT INTO app_usage (user_id, app, quantity, in_use) VALUES ($1, 'threads', 1, true)`, [ids.u1]);
  const u2 = await client.query<{ id: string }>(`INSERT INTO users (clerk_user_id, email) VALUES ('u2', 'u2@example.com') RETURNING id`);
  ids.u2 = u2.rows[0]!.id;
  await client.query(`INSERT INTO app_usage (user_id, app, quantity, in_use) VALUES ($1, 'threads', 1, true)`, [ids.u2]);
  // 上限：前の版が古い列だけに書いた（u1 は新しい値、u2 は既定に戻した）、既定の値も古い列だけ変わった
  await client.query(`UPDATE users SET account_limit = 9 WHERE id = $1`, [ids.u1]);
  await client.query(`INSERT INTO user_app_limits (user_id, app, key, value) VALUES ($1, 'threads', 'accounts', 3), ($2, 'threads', 'daily_posts', 5)`, [
    ids.u1,
    ids.u2,
  ]);
  await client.query(`UPDATE operator_settings SET default_account_limit = 6 WHERE id = 1`);
  await applyMigrations(client, migrationIndex("0027"), migrationIndex("0027"));
});

afterAll(async () => {
  await drop?.();
});

describe("0027_recopy_usage", () => {
  it("利用の数を今のアカウントの数で写し直す", async () => {
    const { rows } = await client.query(`SELECT user_id, quantity, in_use FROM app_usage WHERE app = 'threads'`);
    const by = Object.fromEntries(rows.map((r) => [r.user_id, [r.quantity, r.in_use]]));
    expect(by[ids.u1!]).toEqual([2, true]);
    expect(by[ids.u2!]).toEqual([0, false]);
  });

  it("上限を古い列の値で写し直す（古い列が null なら新しい表の行を消す）", async () => {
    const { rows } = await client.query(`SELECT user_id, key, value FROM user_app_limits ORDER BY key`);
    expect(rows).toEqual([{ user_id: ids.u1, key: "accounts", value: 9 }]);
    const d = await client.query(`SELECT key, value FROM app_limit_defaults WHERE app = 'threads' ORDER BY key`);
    expect(d.rows).toEqual([
      { key: "accounts", value: 6 },
      { key: "daily_posts", value: 10 },
    ]);
  });
});
