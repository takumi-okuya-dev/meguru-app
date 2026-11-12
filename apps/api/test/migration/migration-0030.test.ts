// 0030_threads_schema のテスト（specs/meguru/029-threads-pattern1 tasks.md T039、spec SC-001・SC-005）。
// Threadsの34表をスキーマ threads へ移し（3表は名前も変える）、共通 ⇄ Threads の外部キーを外す。中身は1行も変わらない。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
const ids: Record<string, string> = {};

/** 移す表（前の名前 → スキーマ threads での名前）。 */
const MOVED: Record<string, string> = {
  accounts: "accounts",
  memberships: "memberships",
  teams: "teams",
  team_members: "team_members",
  team_accounts: "team_accounts",
  activity_logs: "activity_logs",
  threads_connections: "threads_connections",
  token_check_failures: "token_check_failures",
  oauth_states: "oauth_states",
  threads_deletion_requests: "threads_deletion_requests",
  threads_revocations: "threads_revocations",
  strategy_designs: "strategy_designs",
  promotions: "promotions",
  reference_posts: "reference_posts",
  research_keywords: "research_keywords",
  draft_batches: "draft_batches",
  post_drafts: "post_drafts",
  posting_schedules: "posting_schedules",
  publish_attempts: "publish_attempts",
  ng_words: "ng_words",
  post_metrics: "post_metrics",
  post_metric_snapshots: "post_metric_snapshots",
  follower_snapshots: "follower_snapshots",
  tester_applications: "tester_applications",
  promotion_listings: "promotion_listings",
  media_defaults: "media_defaults",
  analysis_settings: "analysis_settings",
  post_classifications: "post_classifications",
  mention_settings: "mention_settings",
  mention_people: "mention_people",
  post_mentions: "post_mentions",
  threads_received_events: "received_events",
  threads_user_states: "user_states",
  threads_settings: "settings",
};

/**
 * 表の件数と、全行の中身の指紋（行を文字にして並べた md5）を返す。
 * @param table - スキーマ付きの表の名前
 * @returns 件数と指紋
 */
async function fingerprint(table: string): Promise<{ count: number; hash: string | null }> {
  const { rows } = await client.query<{ count: number; hash: string | null }>(
    `SELECT count(*)::int AS count, md5(string_agg(t::text, '|' ORDER BY t::text)) AS hash FROM ${table} t`,
  );
  return rows[0]!;
}

const before: Record<string, { count: number; hash: string | null }> = {};

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0030") - 1);
  const user = async (name: string) =>
    (await client.query<{ id: string }>(`INSERT INTO users (clerk_user_id, email) VALUES ($1, $2) RETURNING id`, [name, `${name}@example.com`])).rows[0]!.id;
  ids.owner = await user("owner");
  ids.member = await user("member");
  ids.account = (
    await client.query<{ id: string }>(
      `INSERT INTO accounts (name, connection_status, connection_method, core_rules_updated_by_user_id) VALUES ('店', 'not_connected', NULL, $1) RETURNING id`,
      [ids.owner],
    )
  ).rows[0]!.id;
  ids.team = (
    await client.query<{ id: string }>(
      `INSERT INTO teams (name, admin_user_id, invite_token_hash, invite_token_ciphertext, invite_token_iv, invite_key_version)
       VALUES ('飲食', $1, 'hash', '\\x00', '\\x00', 1) RETURNING id`,
      [ids.owner],
    )
  ).rows[0]!.id;
  await client.query(`INSERT INTO memberships (user_id, account_id, role) VALUES ($1, $2, 'owner')`, [ids.owner, ids.account]);
  await client.query(`INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'member')`, [ids.team, ids.owner, ids.member]);
  await client.query(`INSERT INTO team_accounts (team_id, account_id, added_by_user_id) VALUES ($1, $2, $3)`, [ids.team, ids.account, ids.owner]);
  await client.query(
    `INSERT INTO activity_logs (account_id, actor_user_id, actor_name, actor_role, kind, action) VALUES ($1, $2, 'オーナー', 'owner', 'settings', 'threads_reconnected')`,
    [ids.account, ids.owner],
  );
  const batch = await client.query<{ id: string }>(
    `INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found) VALUES ($1, gen_random_uuid(), 2, true) RETURNING id`,
    [ids.account],
  );
  await client.query(`INSERT INTO post_drafts (account_id, batch_id, position, body, created_by_user_id) VALUES ($1, $2, 0, '案1', $3), ($1, $2, 1, '案2', $3)`, [
    ids.account,
    batch.rows[0]!.id,
    ids.owner,
  ]);
  await client.query(
    `INSERT INTO publish_attempts (account_id, slot_at, slot_date, slot_minute, state, last_error) VALUES ($1, '2030-01-01T03:00:00Z', '2030-01-01', 720, 'carried_over', 'threads_server')`,
    [ids.account],
  );
  await client.query(`INSERT INTO ng_words (account_id, word, normalized) VALUES ($1, '禁止', '禁止')`, [ids.account]);
  ids.application = (
    await client.query<{ id: string }>(`INSERT INTO tester_applications (threads_username, user_id) VALUES ('shop_tokyo', $1) RETURNING id`, [ids.owner])
  ).rows[0]!.id;
  await client.query(`INSERT INTO operator_events (actor_user_id, subject_user_id, application_id, action) VALUES ($1, $1, $2, 'apply')`, [ids.owner, ids.application]);
  await client.query(`INSERT INTO threads_received_events (event_id) VALUES (gen_random_uuid())`);
  await client.query(`INSERT INTO threads_user_states (user_id, last_account_id) VALUES ($1, $2)`, [ids.owner, ids.account]);
  await client.query(`UPDATE threads_settings SET tester_slot_capacity = 40`);
  for (const old of Object.keys(MOVED)) before[old] = await fingerprint(`public."${old}"`);
  await applyMigrations(client, migrationIndex("0030"), migrationIndex("0030"));
});

afterAll(async () => {
  await drop?.();
});

describe("0030_threads_schema", () => {
  it("34表がスキーマ threads に移り、件数と中身が1行も変わらない（public には残らない）", async () => {
    expect(Object.keys(MOVED)).toHaveLength(34);
    for (const [old, name] of Object.entries(MOVED)) {
      expect({ table: name, ...(await fingerprint(`threads."${name}"`)) }).toEqual({ table: name, ...before[old] });
      const left = await client.query(`SELECT to_regclass($1) AS t`, [`public."${old}"`]);
      expect(left.rows[0].t).toBeNull();
    }
    expect(before.accounts!.count).toBe(1);
    expect(before.post_drafts!.count).toBe(2);
    expect(before.threads_settings!.count).toBe(1);
  });

  it("共通 ⇄ Threads の外部キーが0本（quickstart.md 1 の数え方）", async () => {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint c
       JOIN pg_class s ON s.oid = c.conrelid JOIN pg_namespace sn ON sn.oid = s.relnamespace
       JOIN pg_class t ON t.oid = c.confrelid JOIN pg_namespace tn ON tn.oid = t.relnamespace
       WHERE c.contype = 'f' AND sn.nspname <> tn.nspname`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("Threadsの中の外部キーは残る（アカウントを消すと、下書き・メンバー・チームの結びつきも消える）", async () => {
    await client.query(`DELETE FROM threads.accounts WHERE id = $1`, [ids.account]);
    const counts = await client.query(
      `SELECT (SELECT count(*)::int FROM threads.post_drafts) AS drafts, (SELECT count(*)::int FROM threads.memberships) AS memberships,
         (SELECT count(*)::int FROM threads.team_accounts) AS team_accounts,
         (SELECT last_account_id FROM threads.user_states WHERE user_id = $1) AS last_account`,
      [ids.owner],
    );
    expect(counts.rows[0]).toEqual({ drafts: 0, memberships: 0, team_accounts: 0, last_account: null });
  });

  it("users の行は、Threadsの行があっても消せる（片づけは出来事 user.withdrawn で Threads が行う）", async () => {
    await client.query(`DELETE FROM users WHERE id = $1`, [ids.member]);
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM threads.team_members WHERE user_id = $1`, [ids.member]);
    expect(rows[0].n).toBe(1);
  });

  it("番号を振る列（ng_words.seq）は、移したあとも続きの番号を振る", async () => {
    const acc = await client.query<{ id: string }>(`INSERT INTO threads.accounts (name, connection_status, connection_method) VALUES ('店2', 'not_connected', NULL) RETURNING id`);
    const { rows } = await client.query<{ seq: string }>(`INSERT INTO threads.ng_words (account_id, word, normalized) VALUES ($1, '次', '次') RETURNING seq`, [
      acc.rows[0]!.id,
    ]);
    expect(Number(rows[0]!.seq)).toBe(2);
  });
});
