// 機能のまとまりのテストの部品（specs/019-feature-switches tasks.md）：OFFの行を直接入れる、運営者の環境
import type { Feature } from "@meguru/shared";
import { neon } from "@neondatabase/serverless";
import type { Env } from "../../src/kernel/env";
import { call, db, testEnv, type TestApp } from "./app";

/** 運営者の Clerk のユーザーID（テストの偽の認証では "test:fop"）。 */
export const FEATURE_OPERATOR = "fop";

/** 招待制はOFFのまま、運営者だけを決めた環境（本番と同じ形。research.md R5）。 */
export function operatorEnv(over: Partial<Env> = {}): Env {
  return { ...testEnv, OPERATOR_CLERK_USER_IDS: FEATURE_OPERATOR, ...over } as Env;
}

/** 運営者を決めた環境で API を呼ぶ。 */
export function callOp(app: TestApp, method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  return call(app, method, path, { ...opts, env: operatorEnv() });
}

/**
 * 運営者の画面を通さずに、まとまりをOFFにする。
 * @param userId - users.id
 * @param features - OFFにするまとまり
 */
export async function disableFeatures(userId: string, ...features: Feature[]) {
  db(); // ローカルプロキシの設定
  const sql = neon(testEnv.DATABASE_URL);
  for (const f of features) await sql`INSERT INTO feature_disables (user_id, feature) VALUES (${userId}, ${f}) ON CONFLICT DO NOTHING`;
}

/**
 * まとまりのOFFをすべて消す（すべてON）。
 * @param userId - users.id
 */
export async function enableAll(userId: string) {
  db();
  await neon(testEnv.DATABASE_URL)`DELETE FROM feature_disables WHERE user_id = ${userId}`;
}

/**
 * グループの設定でまとまりをOFFにする（運営者の画面を通さない）。
 * @param groupId - test_groups.id
 * @param features - OFFにするまとまり
 */
export async function disableGroupFeatures(groupId: string, ...features: Feature[]) {
  db();
  const sql = neon(testEnv.DATABASE_URL);
  for (const f of features) await sql`INSERT INTO group_feature_disables (group_id, feature) VALUES (${groupId}, ${f}) ON CONFLICT DO NOTHING`;
}

/**
 * グループを直接作り、人を入れる（招待の文字列を通さない）。料金なしの印は付けない。
 * @param name - グループ名
 * @param userIds - 入れる人の users.id
 * @returns test_groups.id
 */
export async function makeGroup(name: string, userIds: string[] = []) {
  db();
  const sql = neon(testEnv.DATABASE_URL);
  const [g] = (await sql`
    INSERT INTO test_groups (name, capacity, invite_token_hash, invite_token_ciphertext, invite_token_iv, invite_key_version)
    VALUES (${name}, 10, ${`hash_${name}_${crypto.randomUUID()}`}, decode('00', 'hex'), decode('00', 'hex'), 1) RETURNING id`) as [{ id: string }];
  for (const u of userIds) await sql`INSERT INTO test_group_members (user_id, group_id) VALUES (${u}, ${g.id})`;
  return g.id;
}

/**
 * グループを閉じる（行は消さずに closed_at を入れる。判定から外れることを確かめる）。
 * @param groupId - test_groups.id
 */
export async function closeGroupRow(groupId: string) {
  db();
  await neon(testEnv.DATABASE_URL)`UPDATE test_groups SET closed_at = now() WHERE id = ${groupId}`;
}
