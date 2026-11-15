// 0026_app_foundation のテスト（specs/meguru/029-threads-pattern1 data-model.md 2・5、T008）。
// 出来事・利用の数・上限の表を足し、今のデータを写す。機能のON/OFFの表にアプリの番号を足し、今の行はThreadsのものとして残す。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
const ids: Record<string, string> = {};

/**
 * 利用者を作る。
 * @param clerk - Clerk のユーザーID
 * @param limits - 利用者ごとの上限（なければ null）
 * @returns users.id
 */
async function user(clerk: string, limits: { account: number | null; daily: number | null } = { account: null, daily: null }) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (clerk_user_id, email, account_limit, daily_post_limit) VALUES ($1, $2, $3, $4) RETURNING id`,
    [clerk, `${clerk}@example.com`, limits.account, limits.daily],
  );
  return rows[0]!.id;
}

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
  await applyMigrations(client, 0, migrationIndex("0026") - 1);
  // 持ち主（2件）・担当だけ（チームの編集者）・チームだけ・どちらもない人
  ids.owner = await user("owner", { account: 5, daily: 20 });
  await ownedAccount(ids.owner);
  const shared = await ownedAccount(ids.owner);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO teams (name, admin_user_id, invite_token_hash, invite_token_ciphertext, invite_token_iv, invite_key_version)
     VALUES ('飲食', $1, 'hash', '\\x00', '\\x00', 1) RETURNING id`,
    [ids.owner],
  );
  const teamId = rows[0]!.id;
  ids.editor = await user("editor");
  await client.query(`INSERT INTO memberships (user_id, account_id, role, team_id) VALUES ($1, $2, 'editor', $3)`, [
    ids.editor,
    shared,
    teamId,
  ]);
  ids.teamOnly = await user("team-only");
  await client.query(`INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'member')`, [teamId, ids.teamOnly]);
  ids.none = await user("none");
  // 機能のOFF（今の行）
  await client.query(`INSERT INTO feature_disables (user_id, feature) VALUES ($1, 'strategy')`, [ids.owner]);
  await client.query(`UPDATE operator_settings SET default_account_limit = 4, default_daily_post_limit = 12 WHERE id = 1`);
  await applyMigrations(client, migrationIndex("0026"), migrationIndex("0026"));
});

afterAll(async () => {
  await drop?.();
});

describe("0026_app_foundation", () => {
  it("利用の数：持ち主としてのアカウントの数と、使っているか（メンバーかチーム）を全員分写す", async () => {
    const { rows } = await client.query(`SELECT user_id, app, quantity, in_use FROM app_usage ORDER BY user_id`);
    const byUser = Object.fromEntries(rows.map((r) => [r.user_id, { app: r.app, quantity: r.quantity, using: r.in_use }]));
    expect(byUser[ids.owner!]).toEqual({ app: "threads", quantity: 2, using: true });
    expect(byUser[ids.editor!]).toEqual({ app: "threads", quantity: 0, using: true });
    expect(byUser[ids.teamOnly!]).toEqual({ app: "threads", quantity: 0, using: true });
    expect(byUser[ids.none!]).toEqual({ app: "threads", quantity: 0, using: false });
  });

  it("上限：利用者ごとの値はある人だけ、既定の値は運営の設定から写す", async () => {
    const { rows } = await client.query(`SELECT user_id, app, key, value FROM user_app_limits ORDER BY key`);
    expect(rows).toEqual([
      { user_id: ids.owner, app: "threads", key: "accounts", value: 5 },
      { user_id: ids.owner, app: "threads", key: "daily_posts", value: 20 },
    ]);
    const defaults = await client.query(`SELECT app, key, value FROM app_limit_defaults ORDER BY key`);
    expect(defaults.rows).toEqual([
      { app: "threads", key: "accounts", value: 4 },
      { app: "threads", key: "daily_posts", value: 12 },
    ]);
  });

  it("機能のOFF：今の行は app = 'threads' で残り、同じ名前でもアプリが違えば別の行にできる", async () => {
    const { rows } = await client.query(`SELECT app, feature FROM feature_disables WHERE user_id = $1`, [ids.owner]);
    expect(rows).toEqual([{ app: "threads", feature: "strategy" }]);
    await client.query(`INSERT INTO feature_disables (user_id, app, feature) VALUES ($1, 'people', 'strategy')`, [ids.owner]);
    const after = await client.query(`SELECT count(*)::int AS n FROM feature_disables WHERE user_id = $1`, [ids.owner]);
    expect(after.rows[0].n).toBe(2);
  });

  it("名前の形を確かめる：機能の名前・出来事の種類", async () => {
    await expect(
      client.query(`INSERT INTO feature_disables (user_id, feature) VALUES ($1, 'Bad Name')`, [ids.none]),
    ).rejects.toThrow(/feature_disables_feature_valid/);
    await expect(client.query(`INSERT INTO platform_events (type, payload) VALUES ('withdrawn', '{}')`)).rejects.toThrow(
      /platform_events_type_valid/,
    );
    await client.query(`INSERT INTO platform_events (type, payload) VALUES ('user.withdrawn', '{}')`);
  });
});
