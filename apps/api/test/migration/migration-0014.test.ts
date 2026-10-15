// 0014_billing のテスト（specs/013-billing data-model.md）。
// 今の利用者・アカウントを入れてから0014を当て、件数が変わらず、旧プランの列と型がなくなり、
// 契約・退会の表と列ができることを確かめる。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
let ownerId: string;

const COUNTED = ["users", "accounts", "memberships", "post_drafts", "team_members"] as const;

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

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0014") - 1);
  const owner = await one<{ id: string }>(
    `INSERT INTO users (clerk_user_id, email, display_name) VALUES ('owner', 'owner@example.com', 'オーナー') RETURNING id`,
  );
  ownerId = owner.id;
  const a1 = await one<{ id: string }>(
    `INSERT INTO accounts (name, threads_user_id, username, plan) VALUES ('カフェ', 'tu1', 'cafe_b', 'multi-account') RETURNING id`,
  );
  const a2 = await one<{ id: string }>(
    `INSERT INTO accounts (name, plan, connection_status, connection_method) VALUES ('未接続', 'auto-only', 'not_connected', NULL) RETURNING id`,
  );
  for (const a of [a1, a2]) {
    await client.query(`INSERT INTO memberships (user_id, account_id, role) VALUES ($1, $2, 'owner')`, [owner.id, a.id]);
  }
  const batch = await one<{ id: string }>(
    `INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found) VALUES ($1, gen_random_uuid(), 1, true) RETURNING id`,
    [a1.id],
  );
  await client.query(`INSERT INTO post_drafts (account_id, batch_id, position, body) VALUES ($1, $2, 0, '案')`, [a1.id, batch.id]);
});

afterAll(async () => {
  await drop?.();
});

describe("0014_billing", () => {
  it("件数が変わらず、accounts.plan と型 account_plan がなくなり、今の利用者は料金なしでない", async () => {
    const before = await counts();
    await applyMigrations(client, migrationIndex("0014"), migrationIndex("0014"));
    expect(await counts()).toEqual(before);
    const col = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'plan'`,
    );
    expect(col.rowCount).toBe(0);
    const type = await client.query(`SELECT 1 FROM pg_type WHERE typname = 'account_plan'`);
    expect(type.rowCount).toBe(0);
    const u = await one<{ billing_exempt: boolean; withdrawal_requested_at: Date | null }>(
      `SELECT billing_exempt, withdrawal_requested_at FROM users WHERE id = $1`,
      [ownerId],
    );
    expect(u).toEqual({ billing_exempt: false, withdrawal_requested_at: null });
  });

  it("subscriptions.status は表にある値か NULL だけ", async () => {
    await client.query(`INSERT INTO subscriptions (user_id, stripe_customer_id, status) VALUES ($1, 'cus_1', 'trialing')`, [ownerId]);
    await client.query(`UPDATE subscriptions SET status = NULL WHERE user_id = $1`, [ownerId]);
    await expect(client.query(`UPDATE subscriptions SET status = 'free' WHERE user_id = $1`, [ownerId])).rejects.toThrow(
      /subscriptions_status_valid/,
    );
  });

  it("飛ばす理由に billing_inactive が入る", async () => {
    const { rows } = await client.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'publish_attempts_skip_reason_valid'`,
    );
    expect(rows[0]!.def).toContain("billing_inactive");
  });

  it("users を消すと subscriptions の行も消える。withdrawn_users はメールアドレスを持たない", async () => {
    await client.query(`DELETE FROM memberships WHERE user_id = $1`, [ownerId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
    const sub = await client.query(`SELECT 1 FROM subscriptions WHERE user_id = $1`, [ownerId]);
    expect(sub.rowCount).toBe(0);
    const cols = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'withdrawn_users' ORDER BY column_name`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual(["clerk_deleted_at", "clerk_user_id", "withdrawn_at"]);
  });
});
