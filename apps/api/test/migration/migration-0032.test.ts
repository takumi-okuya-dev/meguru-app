// 0032_app_access_grants のテスト（specs/meguru/030-app-access tasks.md T002）。
// 人ごと・テストのグループごとのアプリの利用の許可の表を2つ足すだけ。今の表とデータは変えない。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
const ids: Record<string, string> = {};

/**
 * 利用者を作る。
 * @param clerk - Clerk のユーザーID
 * @returns users.id
 */
async function user(clerk: string) {
  const { rows } = await client.query<{ id: string }>(`INSERT INTO users (clerk_user_id, email) VALUES ($1, $2) RETURNING id`, [
    clerk,
    `${clerk}@example.com`,
  ]);
  return rows[0]!.id;
}

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0032") - 1);
  ids.u1 = await user("u1");
  ids.op = await user("op");
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO test_groups (name, capacity, invite_token_hash, invite_token_ciphertext, invite_token_iv, invite_key_version)
     VALUES ('飲食の会', 10, 'hash', '\\x00', '\\x00', 1) RETURNING id`,
  );
  ids.group = rows[0]!.id;
  await applyMigrations(client, migrationIndex("0032"), migrationIndex("0032"));
});

afterAll(async () => {
  await drop?.();
});

describe("0032_app_access_grants", () => {
  it("2つの表ができ、今の利用者とグループに許可を書ける", async () => {
    await client.query(`INSERT INTO app_access_grants (app, user_id, granted_by) VALUES ('demo-granted', $1, $2)`, [ids.u1, ids.op]);
    await client.query(`INSERT INTO group_app_access_grants (app, group_id, granted_by) VALUES ('demo-granted', $1, $2)`, [ids.group, ids.op]);
    const own = await client.query(`SELECT app, user_id, granted_by, granted_at IS NOT NULL AS has_time FROM app_access_grants`);
    expect(own.rows).toEqual([{ app: "demo-granted", user_id: ids.u1, granted_by: ids.op, has_time: true }]);
    const group = await client.query(`SELECT app, group_id FROM group_app_access_grants`);
    expect(group.rows).toEqual([{ app: "demo-granted", group_id: ids.group }]);
  });

  it("同じアプリと人（グループ）は1行だけ。アプリの名前の形が違えば入らない", async () => {
    await expect(
      client.query(`INSERT INTO app_access_grants (app, user_id) VALUES ('demo-granted', $1)`, [ids.u1]),
    ).rejects.toThrow(/app_access_grants_pkey/);
    await expect(client.query(`INSERT INTO app_access_grants (app, user_id) VALUES ('Demo', $1)`, [ids.u1])).rejects.toThrow(
      /app_access_grants_app_valid/,
    );
    await expect(
      client.query(`INSERT INTO group_app_access_grants (app, group_id) VALUES ('demo_x', $1)`, [ids.group]),
    ).rejects.toThrow(/group_app_access_grants_app_valid/);
  });

  it("開いた運営者が消えたら granted_by は null、人・グループが消えたら行も消える", async () => {
    await client.query(`DELETE FROM users WHERE id = $1`, [ids.op]);
    expect((await client.query(`SELECT granted_by FROM app_access_grants`)).rows).toEqual([{ granted_by: null }]);
    expect((await client.query(`SELECT granted_by FROM group_app_access_grants`)).rows).toEqual([{ granted_by: null }]);
    await client.query(`DELETE FROM users WHERE id = $1`, [ids.u1]);
    await client.query(`DELETE FROM test_groups WHERE id = $1`, [ids.group]);
    expect((await client.query(`SELECT count(*)::int AS n FROM app_access_grants`)).rows[0].n).toBe(0);
    expect((await client.query(`SELECT count(*)::int AS n FROM group_app_access_grants`)).rows[0].n).toBe(0);
  });
});
