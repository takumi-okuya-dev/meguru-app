// 0013_accounts_before_connect のテスト（specs/012-accounts-before-connect data-model.md「確かめること」、FR-044）。
// 今のアカウントを入れてから0013を当て、状態とデータの件数が変わらず、名前が表示名（なければユーザー名）で埋まることと、
// 未接続のアカウントの決まり（CHECK制約）を確かめる。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;

const COUNTED = ["accounts", "post_drafts", "strategy_designs", "activity_logs", "users"] as const;

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

const LONG = "あ".repeat(49) + " い"; // 51文字（50文字目が空白）

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0013") - 1);
  const owner = await one<{ id: string }>(
    `INSERT INTO users (clerk_user_id, email, display_name) VALUES ('owner', 'owner@example.com', 'オーナー') RETURNING id`,
  );
  const insert = (tu: string, username: string, displayName: string | null, status = "connected") =>
    one<{ id: string }>(
      `INSERT INTO accounts (threads_user_id, username, display_name, plan, connection_status) VALUES ($1, $2, $3, 'auto-only', $4) RETURNING id`,
      [tu, username, displayName, status],
    );
  const a1 = await insert("tu1", "cafe_b", "Cafe B");
  await insert("tu2", "shop_c", null, "needs_reconnect");
  await insert("tu3", "blank_d", "   ");
  await insert("tu4", "long_e", LONG);
  await client.query(`INSERT INTO memberships (user_id, account_id, role) VALUES ($1, $2, 'owner')`, [owner.id, a1.id]);
  await client.query(`INSERT INTO strategy_designs (account_id, final_action) VALUES ($1, '来店')`, [a1.id]);
  await client.query(
    `INSERT INTO activity_logs (account_id, actor_user_id, actor_name, actor_role, kind, action) VALUES ($1, $2, 'オーナー', 'owner', 'settings', 'threads_reconnected')`,
    [a1.id, owner.id],
  );
});

afterAll(async () => {
  await drop?.();
});

describe("0013_accounts_before_connect", () => {
  it("今のアカウントの状態と件数が変わらず、名前が表示名（空・空白だけならユーザー名）の先頭50文字で埋まる", async () => {
    const before = await counts();
    await applyMigrations(client, migrationIndex("0013"), migrationIndex("0013"));
    expect(await counts()).toEqual(before);
    const rows = await client.query<{ username: string; name: string; connection_status: string; connection_method: string }>(
      `SELECT username, name, connection_status::text, connection_method::text FROM accounts ORDER BY threads_user_id`,
    );
    expect(rows.rows).toEqual([
      { username: "cafe_b", name: "Cafe B", connection_status: "connected", connection_method: "app" },
      { username: "shop_c", name: "shop_c", connection_status: "needs_reconnect", connection_method: "app" },
      { username: "blank_d", name: "blank_d", connection_status: "connected", connection_method: "app" },
      // 50文字で切ったあとの末尾の空白は落とす（名前の CHECK を満たす）
      { username: "long_e", name: "あ".repeat(49), connection_status: "connected", connection_method: "app" },
    ]);
  });

  it("未接続のアカウントは、Threadsのユーザー・ユーザー名・接続の方法がそろって NULL。2つ作っても一意制約にかからない", async () => {
    const insertUnconnected = (name: string) =>
      client.query(
        `INSERT INTO accounts (name, plan, connection_status, connection_method) VALUES ($1, 'auto-only', 'not_connected', NULL)`,
        [name],
      );
    await insertUnconnected("カフェの公式");
    await insertUnconnected("カフェの公式");
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM accounts WHERE threads_user_id IS NULL`)).n)).toBe(2);
  });

  it("CHECK制約：状態と列がそろわない行、名前が空・前後に空白・51文字の行は拒まれる", async () => {
    await expect(
      client.query(
        `INSERT INTO accounts (name, username, plan, connection_status, connection_method) VALUES ('x', 'only_name', 'auto-only', 'not_connected', NULL)`,
      ),
    ).rejects.toThrow(/accounts_connection_consistency/);
    // 既定値（connection_status = connected・connection_method = app）のまま Threads のユーザーを入れ忘れた行
    await expect(client.query(`INSERT INTO accounts (name, plan) VALUES ('x', 'auto-only')`)).rejects.toThrow(
      /accounts_connection_consistency/,
    );
    await expect(client.query(`UPDATE accounts SET threads_user_id = NULL WHERE username = 'cafe_b'`)).rejects.toThrow(
      /accounts_connection_consistency/,
    );
    for (const name of ["", " カフェ", "あ".repeat(51)]) {
      await expect(
        client.query(
          `INSERT INTO accounts (name, plan, connection_status, connection_method) VALUES ($1, 'auto-only', 'not_connected', NULL)`,
          [name],
        ),
        JSON.stringify(name),
      ).rejects.toThrow(/accounts_name_length/);
    }
  });
});
