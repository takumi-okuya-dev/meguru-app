// 0016_test_groups のテスト（specs/016-test-groups data-model.md「users」）。
// 前からいる利用者を入れてから0016を当て、signed_up_open が true になる（締め出さない。FR-007・SC-005）こと、
// 新しく作る行の既定が false であること、グループのCHECKが効くことを確かめる。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0016") - 1);
  await client.query(`INSERT INTO users (clerk_user_id, email) VALUES ('user_before_a', 'a@example.com'), ('user_before_b', 'b@example.com')`);
  await applyMigrations(client, migrationIndex("0016"), migrationIndex("0016"));
});

afterAll(async () => {
  await drop?.();
});

describe("0016_test_groups", () => {
  it("前からいる利用者は、すべて signed_up_open = true になる", async () => {
    const { rows } = await client.query<{ open: boolean }>(`SELECT signed_up_open AS open FROM users ORDER BY clerk_user_id`);
    expect(rows.map((r) => r.open)).toEqual([true, true]);
  });

  it("新しく作る行の既定は false", async () => {
    const { rows } = await client.query<{ open: boolean }>(
      `INSERT INTO users (clerk_user_id, email) VALUES ('user_after', 'c@example.com') RETURNING signed_up_open AS open`,
    );
    expect(rows[0]!.open).toBe(false);
  });

  it("グループの名前の長さと上限の範囲を、DBでも守る", async () => {
    const insert = (name: string, capacity: number) =>
      client.query(
        `INSERT INTO test_groups (name, capacity, invite_token_hash, invite_token_ciphertext, invite_token_iv, invite_key_version)
         VALUES ($1, $2, md5(random()::text), '\\x00', '\\x00', 1)`,
        [name, capacity],
      );
    await expect(insert("会", 1)).resolves.toBeDefined();
    await expect(insert("", 10)).rejects.toThrow(/test_groups_name_length/);
    await expect(insert("会", 0)).rejects.toThrow(/test_groups_capacity_range/);
    await expect(insert("会", 1001)).rejects.toThrow(/test_groups_capacity_range/);
  });
});
