// テスター招待・上限のテストの部品（specs/024-tester-invite-connect tasks.md）：申し込みの行・運営者の環境・設定の初期化
import { neon } from "@neondatabase/serverless";
import type { Env } from "../../src/kernel/env";
import { call, createAccountVia, testEnv, type TestApp } from "./app";

/** 運営者の Clerk のユーザーID（テストの偽の認証では "test:top"）。 */
export const TESTER_OPERATOR = "top";

const q = () => neon(testEnv.DATABASE_URL);

/** 運営者を決めた環境（招待制はOFF。本番と同じ形）。 */
export function testerOperatorEnv(over: Partial<Env> = {}): Env {
  return { ...testEnv, OPERATOR_CLERK_USER_IDS: TESTER_OPERATOR, ...over } as Env;
}

/** 招待の管理がOFF（審査の後）の環境。 */
export function publicEnv(over: Partial<Env> = {}): Env {
  return testerOperatorEnv({ THREADS_ACCESS_MODE: "public", ...over });
}

/**
 * 運営者を決めた環境で API を呼ぶ。
 * @param app - テストのアプリ
 * @param method - HTTPのメソッド
 * @param path - パス
 * @param opts - 呼ぶ人・本文・環境
 * @returns 応答
 */
export function callT(app: TestApp, method: string, path: string, opts: { user?: string; body?: unknown; env?: Env } = {}) {
  return call(app, method, path, { ...opts, env: opts.env ?? testerOperatorEnv() });
}

/** 運営者が決める値（operator_settings）を初めの値に戻す。TRUNCATE では戻らないため。 */
export async function resetOperatorSettings() {
  await q()`UPDATE operator_settings SET default_account_limit = 3, default_daily_post_limit = 10, tester_slot_capacity = 25`;
  await q()`INSERT INTO app_limit_defaults (app, key, value) VALUES ('threads', 'accounts', 3), ('threads', 'daily_posts', 10)
    ON CONFLICT (app, key) DO UPDATE SET value = EXCLUDED.value`;
  await q()`INSERT INTO threads.settings (id, tester_slot_capacity) VALUES (1, 25) ON CONFLICT (id) DO UPDATE SET tester_slot_capacity = 25`;
}

/**
 * 利用者と、つなぐ前のアカウントを API で作る（JIT作成。legacy_trial は false）。
 * @param app - テストのアプリ
 * @param user - Clerk のユーザーID
 * @param name - アカウントの名前
 * @returns accounts.id
 */
export async function unconnectedAccountOf(app: TestApp, user: string, name = "お店のアカウント"): Promise<string> {
  const { accountId, res } = await createAccountVia(app, user, name);
  if (!accountId) throw new Error(`アカウントを作れません：${res.status} ${await res.text()}`);
  return accountId;
}

/**
 * 申し込む（POST /api/accounts/:id/tester-application）。
 * @returns 応答
 */
export function applyFor(app: TestApp, user: string, accountId: string, threadsUsername: string, env?: Env) {
  return callT(app, "POST", `/api/accounts/${accountId}/tester-application`, { user, body: { threadsUsername }, env });
}

/**
 * 申し込みの行を直接読む。
 * @param id - tester_applications.id
 * @returns 行（なければ undefined）
 */
export async function applicationRow(id: string) {
  const rows = (await q()`SELECT * FROM threads.tester_applications WHERE id = ${id}`) as Record<string, unknown>[];
  return rows[0];
}

/**
 * アカウントの申し込みの行（新しい順）を直接読む。
 * @param accountId - accounts.id
 * @returns 行
 */
export async function applicationsOf(accountId: string) {
  return (await q()`SELECT * FROM threads.tester_applications WHERE account_id = ${accountId} ORDER BY created_at DESC`) as Record<string, unknown>[];
}

/**
 * 申し込みを運営者の画面を通さずに「招待済み」にする。
 * @param id - tester_applications.id
 */
export async function markInvited(id: string) {
  await q()`UPDATE threads.tester_applications SET status = 'invited', holds_slot = true, status_changed_at = now() WHERE id = ${id}`;
}

/**
 * 記録（operator_events）をすべて読む。
 * @returns 行
 */
export async function operatorEventRows() {
  return (await q()`SELECT * FROM operator_events ORDER BY created_at`) as Record<string, unknown>[];
}

/** コードを読む。 */
export const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: string[] } }).error.code;
