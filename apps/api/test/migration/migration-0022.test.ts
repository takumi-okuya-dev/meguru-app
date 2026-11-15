// 0022_tester_invites のテスト（specs/024-tester-invite-connect data-model.md 1・2、T004）。
// 表3つと users の列3つを足すだけ。CHECK・部分一意・FK の SET NULL・今いる人の legacy_trial を確かめる。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
let userId: string;
let accountId: string;

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0022") - 1);
  userId = (
    await client.query<{ id: string }>(`INSERT INTO users (clerk_user_id, email) VALUES ('u_before', 'a@example.com') RETURNING id`)
  ).rows[0]!.id;
  accountId = (
    await client.query<{ id: string }>(
      `INSERT INTO accounts (name, connection_status, connection_method) VALUES ('店', 'not_connected', NULL) RETURNING id`,
    )
  ).rows[0]!.id;
  await applyMigrations(client, migrationIndex("0022"), migrationIndex("0022"));
});

afterAll(async () => {
  await drop?.();
});

const apply = (v: Record<string, unknown> = {}) =>
  client.query<{ id: string }>(
    `INSERT INTO tester_applications (user_id, account_id, threads_username, status, holds_slot, removal_reason, decline_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      v.userId === undefined ? userId : v.userId,
      v.accountId === undefined ? accountId : v.accountId,
      v.username ?? "shop_tokyo",
      v.status ?? "pending",
      v.holdsSlot ?? false,
      v.removalReason ?? null,
      v.declineReason ?? null,
    ],
  );

describe("0022_tester_invites", () => {
  it("users：今いる人は legacy_trial が true、上限は NULL、範囲の CHECK", async () => {
    expect((await client.query(`SELECT legacy_trial, account_limit, daily_post_limit FROM users WHERE id = $1`, [userId])).rows[0]).toEqual({
      legacy_trial: true,
      account_limit: null,
      daily_post_limit: null,
    });
    await expect(client.query(`UPDATE users SET account_limit = 0 WHERE id = $1`, [userId])).rejects.toThrow();
    await expect(client.query(`UPDATE users SET account_limit = 1001 WHERE id = $1`, [userId])).rejects.toThrow();
    await expect(client.query(`UPDATE users SET daily_post_limit = 251 WHERE id = $1`, [userId])).rejects.toThrow();
    await client.query(`UPDATE users SET account_limit = 1000, daily_post_limit = 250 WHERE id = $1`, [userId]);
    await client.query(`UPDATE users SET account_limit = NULL, daily_post_limit = NULL WHERE id = $1`, [userId]);
  });

  it("posting_schedules：時刻は250件まで（オーナーの上限は保存の処理で見る。specs/024 FR-019）", async () => {
    const many = Array.from({ length: 250 }, (_, i) => i);
    await client.query(`INSERT INTO posting_schedules (account_id, enabled, slot_minutes) VALUES ($1, true, $2)`, [accountId, many]);
    await expect(
      client.query(`UPDATE posting_schedules SET slot_minutes = $2 WHERE account_id = $1`, [accountId, [...many, 251]]),
    ).rejects.toThrow();
    await client.query(`DELETE FROM posting_schedules`);
  });

  it("operator_settings：1行だけで、既定値と範囲", async () => {
    expect((await client.query(`SELECT id, default_account_limit, default_daily_post_limit, tester_slot_capacity FROM operator_settings`)).rows).toEqual([
      { id: 1, default_account_limit: 3, default_daily_post_limit: 10, tester_slot_capacity: 25 },
    ]);
    await expect(client.query(`INSERT INTO operator_settings (id) VALUES (2)`)).rejects.toThrow();
    await expect(client.query(`UPDATE operator_settings SET default_daily_post_limit = 0`)).rejects.toThrow();
    await expect(client.query(`UPDATE operator_settings SET tester_slot_capacity = 10001`)).rejects.toThrow();
  });

  it("tester_applications：ユーザー名・状態・理由・見送りの理由の CHECK", async () => {
    await expect(apply({ username: "Shop_Tokyo" })).rejects.toThrow();
    await expect(apply({ username: "a".repeat(31) })).rejects.toThrow();
    await expect(apply({ status: "approved" })).rejects.toThrow();
    await expect(apply({ status: "invited", removalReason: "withdrawn" })).rejects.toThrow(); // 理由は取り下げだけ
    await expect(apply({ status: "withdrawn", removalReason: "deleted" })).rejects.toThrow();
    await expect(apply({ status: "declined", declineReason: "あ".repeat(201) })).rejects.toThrow();
    const ok = await apply({ status: "withdrawn", removalReason: "withdrawn", holdsSlot: true });
    await client.query(`DELETE FROM tester_applications WHERE id = $1`, [ok.rows[0]!.id]);
  });

  it("生きている申し込みはアカウント1件に1つまで。見送り・取り下げは重ねられる", async () => {
    await apply({ status: "declined" });
    await apply({ status: "withdrawn" });
    const live = await apply();
    await expect(apply({ status: "invited" })).rejects.toThrow();
    await client.query(`UPDATE tester_applications SET status = 'withdrawn' WHERE id = $1`, [live.rows[0]!.id]);
    await apply({ status: "invited", holdsSlot: true });
  });

  it("アカウント・利用者を消すと、申し込みと記録の参照は NULL になり、行は残る", async () => {
    const app = (await client.query<{ id: string }>(`SELECT id FROM tester_applications WHERE status = 'invited'`)).rows[0]!.id;
    await client.query(
      `INSERT INTO operator_events (actor_user_id, subject_user_id, application_id, action) VALUES ($1, $1, $2, 'apply')`,
      [userId, app],
    );
    await client.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    expect((await client.query(`SELECT user_id, account_id FROM tester_applications WHERE id = $1`, [app])).rows[0]).toEqual({
      user_id: null,
      account_id: null,
    });
    expect((await client.query(`SELECT actor_user_id, subject_user_id FROM operator_events`)).rows[0]).toEqual({
      actor_user_id: null,
      subject_user_id: null,
    });
    await client.query(`DELETE FROM tester_applications WHERE id = $1`, [app]);
    expect((await client.query(`SELECT application_id FROM operator_events`)).rows[0]).toEqual({ application_id: null });
  });
});
