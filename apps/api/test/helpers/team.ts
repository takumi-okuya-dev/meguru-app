// チーム運用のテスト用の部品（specs/008-team-operations）。DBへ直接、チーム・パートナー・編集者・担当を作る。
import { neon } from "@neondatabase/serverless";
import { createDb } from "../../src/db/client";
import { testEnv } from "./app";

function sql() {
  createDb(testEnv.DATABASE_URL); // ローカルプロキシの設定を有効にする
  return neon(testEnv.DATABASE_URL);
}

/**
 * ユーザーを作る（なければ）。clerkUserId は call() の user と同じ文字列。
 * @param user - clerkUserId
 * @param createdAt - 登録日時（無料体験の内外を作る）
 * @returns users.id
 */
export async function ensureUser(user: string, createdAt: Date = new Date()): Promise<string> {
  const [u] = (await sql()`
    INSERT INTO users (clerk_user_id, email, display_name, created_at, updated_at)
    VALUES (${user}, ${`${user}@example.com`}, ${user}, ${createdAt.toISOString()}, ${createdAt.toISOString()})
    ON CONFLICT (clerk_user_id) DO UPDATE SET clerk_user_id = EXCLUDED.clerk_user_id
    RETURNING id`) as [{ id: string }];
  return u.id;
}

/**
 * パートナーのチームを作る（なければ）。
 * @param partner - パートナーの clerkUserId
 * @param name - チーム名
 * @returns teams.id と users.id
 */
export async function ensureTeam(partner: string, name: string | null = `${partner}社`) {
  const partnerUserId = await ensureUser(partner);
  const [t] = (await sql()`
    INSERT INTO teams (partner_user_id, name) VALUES (${partnerUserId}, ${name})
    ON CONFLICT (partner_user_id) DO UPDATE SET partner_user_id = EXCLUDED.partner_user_id
    RETURNING id`) as [{ id: string }];
  return { teamId: t.id, partnerUserId };
}

/**
 * Account にパートナーを付ける（account_partners と memberships(partner)）。
 * @param accountId - 手伝う先
 * @param partner - パートナーの clerkUserId
 * @param delegation - 任せる範囲
 * @returns teams.id と パートナーの users.id
 */
export async function makePartner(
  accountId: string,
  partner: string,
  delegation: { review?: boolean; settings?: boolean } = {},
) {
  const { teamId, partnerUserId } = await ensureTeam(partner);
  const q = sql();
  await q`INSERT INTO account_partners (account_id, team_id, delegate_review, delegate_settings)
    VALUES (${accountId}, ${teamId}, ${delegation.review ?? false}, ${delegation.settings ?? false})`;
  await q`INSERT INTO memberships (user_id, account_id, role, team_id)
    VALUES (${partnerUserId}, ${accountId}, 'partner', ${teamId})`;
  return { teamId, partnerUserId };
}

/**
 * チームに編集者を入れ、担当を付ける（team_editors と memberships(editor)）。
 * @param teamId - チーム
 * @param editor - 編集者の clerkUserId
 * @param accountIds - 担当にするAccount（空なら担当なし）
 * @returns 編集者の users.id
 */
export async function makeEditor(teamId: string, editor: string, accountIds: string[] = []) {
  const userId = await ensureUser(editor);
  const q = sql();
  await q`INSERT INTO team_editors (team_id, user_id) VALUES (${teamId}, ${userId}) ON CONFLICT DO NOTHING`;
  for (const accountId of accountIds) {
    await q`INSERT INTO memberships (user_id, account_id, role, team_id) VALUES (${userId}, ${accountId}, 'editor', ${teamId})`;
  }
  return userId;
}

/**
 * 任せる範囲を変える。
 * @param accountId - Account
 * @param delegation - 任せる範囲
 */
export async function setDelegation(accountId: string, delegation: { review: boolean; settings: boolean }) {
  await sql()`UPDATE account_partners SET delegate_review = ${delegation.review}, delegate_settings = ${delegation.settings}
    WHERE account_id = ${accountId}`;
}

/** 操作の記録を読む（新しい順）。 */
export async function activityRows(accountId: string) {
  return (await sql()`SELECT * FROM activity_logs WHERE account_id = ${accountId} ORDER BY created_at DESC`) as {
    action: string;
    kind: string;
    actor_role: string;
    actor_name: string;
    item_count: number;
    summary: string | null;
    details: Record<string, unknown> | null;
  }[];
}
