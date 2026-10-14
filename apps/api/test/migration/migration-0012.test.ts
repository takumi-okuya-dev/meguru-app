// 0012_team_revision のテスト（specs/011-team-revision SC-006、research.md R2）。
// 008の形のデータ（パートナー・編集者・担当・任せる範囲・招待）を入れてから0012を当て、
// アカウントのデータと操作の記録は1件も減らず、008のチームのデータだけが消えることを確かめる。
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

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0012") - 1);
  // 008の形のデータ
  const owner = await one<{ id: string }>(
    `INSERT INTO users (clerk_user_id, email, display_name) VALUES ('owner', 'owner@example.com', 'オーナー') RETURNING id`,
  );
  const partner = await one<{ id: string }>(
    `INSERT INTO users (clerk_user_id, email, display_name) VALUES ('partner', 'partner@example.com', 'パートナー') RETURNING id`,
  );
  const editor = await one<{ id: string }>(
    `INSERT INTO users (clerk_user_id, email, display_name) VALUES ('editor', 'editor@example.com', '編集者') RETURNING id`,
  );
  const account = await one<{ id: string }>(
    `INSERT INTO accounts (threads_user_id, username, plan) VALUES ('tu1', 'cafe_b', 'team') RETURNING id`,
  );
  const partnerOwn = await one<{ id: string }>(
    `INSERT INTO accounts (threads_user_id, username, plan) VALUES ('tu2', 'partner_co', 'team') RETURNING id`,
  );
  await client.query(`INSERT INTO memberships (user_id, account_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')`, [
    owner.id,
    account.id,
    partner.id,
    partnerOwn.id,
  ]);
  const team = await one<{ id: string }>(
    `INSERT INTO teams (partner_user_id, name, editor_invite_token_hash, editor_invite_token_ciphertext, editor_invite_token_iv, editor_invite_key_version, editor_invite_rotated_at)
     VALUES ($1, 'A社', 'hash-e', '\\x00', '\\x00', 1, now()) RETURNING id`,
    [partner.id],
  );
  await client.query(`INSERT INTO team_editors (team_id, user_id) VALUES ($1, $2)`, [team.id, editor.id]);
  await client.query(
    `INSERT INTO account_partners (account_id, team_id, delegate_review, delegate_settings) VALUES ($1, $2, true, true)`,
    [account.id, team.id],
  );
  await client.query(
    `INSERT INTO account_partner_invites (account_id, token_hash, token_ciphertext, token_iv, key_version) VALUES ($1, 'hash-p', '\\x00', '\\x00', 1)`,
    [partnerOwn.id],
  );
  await client.query(`INSERT INTO memberships (user_id, account_id, role, team_id) VALUES ($1, $2, 'partner', $3)`, [
    partner.id,
    account.id,
    team.id,
  ]);
  await client.query(`INSERT INTO memberships (user_id, account_id, role, team_id) VALUES ($1, $2, 'editor', $3), ($1, $4, 'editor', $3)`, [
    editor.id,
    account.id,
    team.id,
    partnerOwn.id,
  ]);
  const batch = await one<{ id: string }>(
    `INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found) VALUES ($1, gen_random_uuid(), 2, true) RETURNING id`,
    [account.id],
  );
  await client.query(
    `INSERT INTO post_drafts (account_id, batch_id, position, body, created_by_user_id) VALUES ($1, $2, 0, '案1', $3), ($1, $2, 1, '案2', $4)`,
    [account.id, batch.id, editor.id, partner.id],
  );
  await client.query(`INSERT INTO strategy_designs (account_id, final_action) VALUES ($1, '来店'), ($2, '問い合わせ')`, [
    account.id,
    partnerOwn.id,
  ]);
  await client.query(
    `INSERT INTO activity_logs (account_id, actor_user_id, actor_name, actor_role, kind, action)
     VALUES ($1, $2, 'パートナー', 'partner', 'member', 'partner_joined'), ($1, $3, '編集者', 'editor', 'draft', 'drafts_registered')`,
    [account.id, partner.id, editor.id],
  );
});

afterAll(async () => {
  await drop?.();
});

describe("0012_team_revision（SC-006）", () => {
  it("アカウント・投稿の案・戦略・操作の記録・利用者の件数が変わらず、008のチームのデータだけが消える", async () => {
    const before = await counts();
    await applyMigrations(client, migrationIndex("0012"), migrationIndex("0012"));
    expect(await counts()).toEqual(before);

    const roles = await client.query<{ role: string }>(`SELECT role FROM memberships ORDER BY role`);
    expect(roles.rows.map((r) => r.role)).toEqual(["owner", "owner"]);
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM teams`)).n)).toBe(0);
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM team_members`)).n)).toBe(0);
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM team_accounts`)).n)).toBe(0);
    for (const table of ["account_partners", "account_partner_invites", "team_editors"]) {
      const exists = await one<{ t: string | null }>(`SELECT to_regclass($1) AS t`, [`public.${table}`]);
      expect(exists.t, table).toBeNull();
    }
    // 008の記録は、した人の役割（partner）ごと残る
    const logs = await client.query<{ actor_role: string }>(`SELECT actor_role::text FROM activity_logs`);
    expect(logs.rows.map((r) => r.actor_role).sort()).toEqual(["editor", "partner"]);
  });

  it("新しい表の決まり：管理者は1チームに1人、1つのアカウントは1つのチームだけ、チーム名は1〜50文字", async () => {
    const admin = await one<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = 'owner'`);
    const other = await one<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = 'editor'`);
    const account = await one<{ id: string }>(`SELECT id FROM accounts WHERE username = 'cafe_b'`);
    const insertTeam = (name: string, hash: string) =>
      client.query<{ id: string }>(
        `INSERT INTO teams (name, admin_user_id, invite_token_hash, invite_token_ciphertext, invite_token_iv, invite_key_version)
         VALUES ($1, $2, $3, '\\x00', '\\x00', 1) RETURNING id`,
        [name, admin.id, hash],
      );
    await expect(insertTeam("", "h0")).rejects.toThrow(/teams_name_length/);
    const t1 = (await insertTeam("飲食チーム", "h1")).rows[0]!.id;
    const t2 = (await insertTeam("美容チーム", "h2")).rows[0]!.id;
    await client.query(`INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'admin')`, [t1, admin.id]);
    await expect(
      client.query(`INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'admin')`, [t1, other.id]),
    ).rejects.toThrow(/team_members_one_admin/);
    await client.query(`INSERT INTO team_accounts (team_id, account_id) VALUES ($1, $2)`, [t1, account.id]);
    await expect(client.query(`INSERT INTO team_accounts (team_id, account_id) VALUES ($1, $2)`, [t2, account.id])).rejects.toThrow(
      /team_accounts_one_team_per_account/,
    );
  });
});
