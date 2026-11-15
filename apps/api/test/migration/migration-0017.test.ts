// 0017_referral_links のテスト（specs/017-referral-links data-model.md「users」）。
// 前からいる利用者は3列ともNULLのままであること、紹介の文字列の重複と自分を紹介した人にすることをDBでも拒むこと、
// 紹介した人の行を消すと紹介された人の referred_by_user_id がNULLになり、referred_at は残ることを確かめる。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0017") - 1);
  await client.query(`INSERT INTO users (clerk_user_id, email) VALUES ('user_before', 'a@example.com')`);
  await applyMigrations(client, migrationIndex("0017"), migrationIndex("0017"));
});

afterAll(async () => {
  await drop?.();
});

const idOf = async (clerk: string) =>
  (await client.query<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = $1`, [clerk])).rows[0]!.id;

describe("0017_referral_links", () => {
  it("前からいる利用者は、3列ともNULL", async () => {
    const { rows } = await client.query(`SELECT referral_code, referred_by_user_id, referred_at FROM users WHERE clerk_user_id = 'user_before'`);
    expect(rows[0]).toEqual({ referral_code: null, referred_by_user_id: null, referred_at: null });
  });

  it("紹介の文字列の重複を拒む", async () => {
    await client.query(`INSERT INTO users (clerk_user_id, email, referral_code) VALUES ('r1', 'r1@example.com', 'r_dup')`);
    await expect(
      client.query(`INSERT INTO users (clerk_user_id, email, referral_code) VALUES ('r2', 'r2@example.com', 'r_dup')`),
    ).rejects.toThrow(/users_referral_code_unique/);
  });

  it("自分を紹介した人にはできない", async () => {
    const id = await idOf("user_before");
    await expect(client.query(`UPDATE users SET referred_by_user_id = id WHERE id = $1`, [id])).rejects.toThrow(/users_not_self_referred/);
  });

  it("紹介した人の行を消すと、紹介された人の referred_by_user_id はNULLになり、referred_at は残る", async () => {
    await client.query(`INSERT INTO users (clerk_user_id, email) VALUES ('referrer', 'x@example.com')`);
    const referrer = await idOf("referrer");
    await client.query(
      `INSERT INTO users (clerk_user_id, email, referred_by_user_id, referred_at) VALUES ('referred', 'y@example.com', $1, now())`,
      [referrer],
    );
    await client.query(`DELETE FROM users WHERE id = $1`, [referrer]);
    const { rows } = await client.query(`SELECT referred_by_user_id, referred_at FROM users WHERE clerk_user_id = 'referred'`);
    expect(rows[0]!.referred_by_user_id).toBeNull();
    expect(rows[0]!.referred_at).not.toBeNull();
  });
});
