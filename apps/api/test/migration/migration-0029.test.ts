// 0029_threads_settings_user_states のテスト（specs/meguru/029-threads-pattern1 tasks.md T024・T071）。
// テスター招待の枠と、利用者ごとの「最後に開いたアカウント」を、共通の表からThreads専用の表へ写す。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
const ids: Record<string, string> = {};

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0029") - 1);
  await client.query(`UPDATE operator_settings SET tester_slot_capacity = 40 WHERE id = 1`);
  const u1 = await client.query<{ id: string }>(`INSERT INTO users (clerk_user_id, email) VALUES ('u1', 'u1@example.com') RETURNING id`);
  ids.u1 = u1.rows[0]!.id;
  const a = await client.query<{ id: string }>(`INSERT INTO accounts (name, connection_status, connection_method) VALUES ('店', 'not_connected', NULL) RETURNING id`);
  ids.a = a.rows[0]!.id;
  await client.query(`INSERT INTO memberships (user_id, account_id, role) VALUES ($1, $2, 'owner')`, [ids.u1, ids.a]);
  await client.query(
    `UPDATE users SET last_account_id = $2, last_account_client_id = 'p', last_account_open_seq = 3, last_account_open_received_at = now(),
       last_account_deleted_at = now() - interval '1 day' WHERE id = $1`,
    [ids.u1, ids.a],
  );
  // 何も開いていない人は写さない
  const u2 = await client.query<{ id: string }>(`INSERT INTO users (clerk_user_id, email) VALUES ('u2', 'u2@example.com') RETURNING id`);
  ids.u2 = u2.rows[0]!.id;
  await applyMigrations(client, migrationIndex("0029"), migrationIndex("0029"));
});

afterAll(async () => {
  await drop?.();
});

describe("0029_threads_settings_user_states", () => {
  it("テスター招待の枠を threads_settings に写す", async () => {
    const { rows } = await client.query(`SELECT id, tester_slot_capacity FROM threads_settings`);
    expect(rows).toEqual([{ id: 1, tester_slot_capacity: 40 }]);
  });

  it("最後に開いたアカウントを threads_user_states に写す（何も開いていない人は写さない）", async () => {
    const { rows } = await client.query(
      `SELECT user_id, last_account_id, last_account_client_id, last_account_open_seq::int AS seq,
         last_account_open_received_at IS NOT NULL AS received, last_account_deleted_at IS NOT NULL AS deleted
       FROM threads_user_states`,
    );
    expect(rows).toEqual([{ user_id: ids.u1, last_account_id: ids.a, last_account_client_id: "p", seq: 3, received: true, deleted: true }]);
  });

  it("写したアカウントを消すと、threads_user_states の last_account_id は空になる", async () => {
    await client.query(`DELETE FROM accounts WHERE id = $1`, [ids.a]);
    const { rows } = await client.query(`SELECT last_account_id FROM threads_user_states WHERE user_id = $1`, [ids.u1]);
    expect(rows).toEqual([{ last_account_id: null }]);
  });
});
