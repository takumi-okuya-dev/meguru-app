// 0024_tester_backfill_connected のテスト（fix：申し込みのないまま「Threadsで許可する」でつながっているアカウントを、
// テスター招待の「接続済み」に足し、枠を使う扱いにする）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
const ids: Record<string, string> = {};

/**
 * アカウントと、そのオーナーを作る。
 * @returns accounts.id
 */
async function account(owner: string, values: { status: string; method: string | null; username: string | null; tuid: string | null }) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO accounts (name, connection_status, connection_method, username, threads_user_id) VALUES ('店', $1, $2, $3, $4) RETURNING id`,
    [values.status, values.method, values.username, values.tuid],
  );
  await client.query(`INSERT INTO memberships (user_id, account_id, role) VALUES ($1, $2, 'owner')`, [owner, rows[0]!.id]);
  return rows[0]!.id;
}

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0024") - 1);
  const owner = (await client.query<{ id: string }>(`INSERT INTO users (clerk_user_id, email) VALUES ('u1', 'u1@example.com') RETURNING id`)).rows[0]!.id;
  ids.owner = owner;
  ids.app = await account(owner, { status: "connected", method: "app", username: "Shop_Tokyo", tuid: "9001" });
  ids.needs = await account(owner, { status: "needs_reconnect", method: "app", username: "cafe_b", tuid: "9003" });
  ids.token = await account(owner, { status: "connected", method: "token", username: "token_shop", tuid: "9002" });
  ids.none = await account(owner, { status: "not_connected", method: null, username: null, tuid: null });
  ids.applied = await account(owner, { status: "connected", method: "app", username: "invited_shop", tuid: "9004" });
  await client.query(
    `INSERT INTO tester_applications (user_id, account_id, threads_username, status, holds_slot, connected_username)
     VALUES ($1, $2, 'invited_shop', 'connected', true, 'invited_shop')`,
    [owner, ids.applied],
  );
  await applyMigrations(client, migrationIndex("0024"), migrationIndex("0024"));
});

afterAll(async () => {
  await drop?.();
});

const rowsOf = async (accountId: string) =>
  (await client.query(`SELECT user_id, threads_username, status, holds_slot, connected_username FROM tester_applications WHERE account_id = $1`, [accountId]))
    .rows;

describe("0024_tester_backfill_connected", () => {
  it("「Threadsで許可する」でつながっている（要再接続も）アカウントに、接続済みで枠を使う記録を足す。名前は小文字", async () => {
    expect(await rowsOf(ids.app!)).toEqual([
      { user_id: ids.owner, threads_username: "shop_tokyo", status: "connected", holds_slot: true, connected_username: "shop_tokyo" },
    ]);
    expect(await rowsOf(ids.needs!)).toEqual([expect.objectContaining({ threads_username: "cafe_b", status: "connected" })]);
  });

  it("トークン・つなぐ前・生きている申し込みがあるアカウントには足さない", async () => {
    expect(await rowsOf(ids.token!)).toEqual([]);
    expect(await rowsOf(ids.none!)).toEqual([]);
    expect(await rowsOf(ids.applied!)).toHaveLength(1);
  });
});
