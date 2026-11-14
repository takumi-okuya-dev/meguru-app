// 0018_feature_switches のテスト（specs/019-feature-switches data-model.md）。
// 表を3つ足すだけで、既存の表に行が増えないこと、まとまり・記録の種類を CHECK で拒むこと、
// 人・グループを消したときに設定と記録が消える（運営者を消したときは NULL になる）ことを確かめる。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0018") - 1);
  await client.query(`INSERT INTO users (clerk_user_id, email) VALUES ('user_before', 'a@example.com')`);
  await applyMigrations(client, migrationIndex("0018"), migrationIndex("0018"));
});

afterAll(async () => {
  await drop?.();
});

const addUser = async (clerk: string) =>
  (await client.query<{ id: string }>(`INSERT INTO users (clerk_user_id, email) VALUES ($1, $2) RETURNING id`, [clerk, `${clerk}@example.com`]))
    .rows[0]!.id;

const addGroup = async (name: string) =>
  (
    await client.query<{ id: string }>(
      `INSERT INTO test_groups (name, capacity, invite_token_hash, invite_token_ciphertext, invite_token_iv, invite_key_version)
       VALUES ($1, 10, $2, '\\x00', '\\x00', 1) RETURNING id`,
      [name, `hash_${name}`],
    )
  ).rows[0]!.id;

const addEvent = (subject: string, actor: string | null, feature = "strategy", action = "disabled") =>
  client.query(
    `INSERT INTO feature_setting_events (subject_user_id, feature, action, actor_user_id, actor_name, subject_name)
     VALUES ($1, $2, $3, $4, '運営者', '利用者')`,
    [subject, feature, action, actor],
  );

describe("0018_feature_switches", () => {
  it("前からいる人には行を作らない（すべてON）", async () => {
    expect((await client.query(`SELECT count(*)::int AS n FROM feature_disables`)).rows[0]!.n).toBe(0);
    expect((await client.query(`SELECT count(*)::int AS n FROM feature_setting_events`)).rows[0]!.n).toBe(0);
    expect((await client.query(`SELECT count(*)::int AS n FROM group_feature_disables`)).rows[0]!.n).toBe(0);
  });

  it("まとまりは3つだけで、同じ組は1行まで", async () => {
    const id = await addUser("u_check");
    await client.query(`INSERT INTO feature_disables (user_id, feature) VALUES ($1, 'autopost'), ($1, 'strategy'), ($1, 'team')`, [id]);
    await expect(client.query(`INSERT INTO feature_disables (user_id, feature) VALUES ($1, 'stock')`, [id])).rejects.toThrow(
      /feature_disables_feature_valid/,
    );
    await expect(client.query(`INSERT INTO feature_disables (user_id, feature) VALUES ($1, 'strategy')`, [id])).rejects.toThrow(
      /feature_disables_pkey/,
    );
  });

  it("記録のまとまりと種類も CHECK で拒む", async () => {
    const id = await addUser("u_event");
    await expect(addEvent(id, null, "stock")).rejects.toThrow(/feature_setting_events_feature_valid/);
    await expect(addEvent(id, null, "strategy", "toggled")).rejects.toThrow(/feature_setting_events_action_valid/);
  });

  it("人を消すと、その人の設定と記録が消える。運営者を消すと NULL になる", async () => {
    const operator = await addUser("u_operator");
    const subject = await addUser("u_subject");
    await client.query(`INSERT INTO feature_disables (user_id, feature, disabled_by_user_id) VALUES ($1, 'strategy', $2)`, [subject, operator]);
    await addEvent(subject, operator);
    const other = await addUser("u_other");
    await client.query(`INSERT INTO feature_disables (user_id, feature, disabled_by_user_id) VALUES ($1, 'team', $2)`, [other, operator]);
    await addEvent(other, operator, "team");

    await client.query(`DELETE FROM users WHERE id = $1`, [operator]);
    const kept = await client.query(`SELECT disabled_by_user_id FROM feature_disables WHERE user_id = $1`, [other]);
    expect(kept.rows[0]!.disabled_by_user_id).toBeNull();
    const keptEvent = await client.query(`SELECT actor_user_id, actor_name FROM feature_setting_events WHERE subject_user_id = $1`, [other]);
    expect(keptEvent.rows[0]).toEqual({ actor_user_id: null, actor_name: "運営者" });

    await client.query(`DELETE FROM users WHERE id = $1`, [subject]);
    expect((await client.query(`SELECT count(*)::int AS n FROM feature_disables WHERE user_id = $1`, [subject])).rows[0]!.n).toBe(0);
    expect((await client.query(`SELECT count(*)::int AS n FROM feature_setting_events WHERE subject_user_id = $1`, [subject])).rows[0]!.n).toBe(0);
  });

  it("グループの設定：まとまりは3つだけで、同じ組は1行まで。グループを消すと設定と記録が消える", async () => {
    const group = await addGroup("g1");
    await client.query(`INSERT INTO group_feature_disables (group_id, feature) VALUES ($1, 'strategy')`, [group]);
    await expect(client.query(`INSERT INTO group_feature_disables (group_id, feature) VALUES ($1, 'strategy')`, [group])).rejects.toThrow(
      /group_feature_disables_pkey/,
    );
    await expect(client.query(`INSERT INTO group_feature_disables (group_id, feature) VALUES ($1, 'stock')`, [group])).rejects.toThrow(
      /group_feature_disables_feature_valid/,
    );
    await client.query(
      `INSERT INTO feature_setting_events (subject_group_id, feature, action, actor_name, subject_name) VALUES ($1, 'strategy', 'disabled', '運営者', 'g1')`,
      [group],
    );
    await client.query(`DELETE FROM test_groups WHERE id = $1`, [group]);
    expect((await client.query(`SELECT count(*)::int AS n FROM group_feature_disables WHERE group_id = $1`, [group])).rows[0]!.n).toBe(0);
    expect((await client.query(`SELECT count(*)::int AS n FROM feature_setting_events WHERE subject_group_id = $1`, [group])).rows[0]!.n).toBe(0);
  });

  it("記録は、人とグループのちょうど一方", async () => {
    const id = await addUser("u_one");
    const group = await addGroup("g2");
    const insert = (u: string | null, g: string | null) =>
      client.query(
        `INSERT INTO feature_setting_events (subject_user_id, subject_group_id, feature, action, actor_name, subject_name)
         VALUES ($1, $2, 'strategy', 'disabled', '運営者', 'x')`,
        [u, g],
      );
    await expect(insert(id, group)).rejects.toThrow(/feature_setting_events_one_subject/);
    await expect(insert(null, null)).rejects.toThrow(/feature_setting_events_one_subject/);
  });
});
