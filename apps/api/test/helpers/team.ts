// チームのテスト用の部品（specs/011-team-revision T005）。DBへ直接、チーム・チームの人・アカウント・担当を作る。
// 招待リンクは本物と同じ形（ハッシュと暗号化した写し）で作るので、作ったチームでも招待のAPIを呼べる。
import { neon } from "@neondatabase/serverless";
import { createDb } from "../../src/db/client";
import { newInviteToken, sealInviteToken } from "../../src/services/invite-service";
import { createUserWithAccount, testEnv } from "./app";

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
 * チームを作る。admin が管理者になり、accountIds（admin がオーナーのもの）がチームに入る。
 * @param admin - 管理者の clerkUserId
 * @param accountIds - 入れるアカウント
 * @param opts - name：チーム名、shared：入れたアカウントを見せるか
 * @returns teams.id・管理者の users.id・招待の文字列
 */
export async function makeTeam(admin: string, accountIds: string[], opts: { name?: string; shared?: boolean } = {}) {
  const adminUserId = await ensureUser(admin);
  const teamId = crypto.randomUUID();
  const token = newInviteToken();
  const sealed = await sealInviteToken(testEnv, token, teamId);
  const q = sql();
  await q`INSERT INTO teams (id, name, admin_user_id, invite_token_hash, invite_token_ciphertext, invite_token_iv, invite_key_version)
    VALUES (${teamId}, ${opts.name ?? `${admin}のチーム`}, ${adminUserId}, ${sealed.hash},
      ${`\\x${Buffer.from(sealed.ciphertext).toString("hex")}`}, ${`\\x${Buffer.from(sealed.iv).toString("hex")}`}, ${sealed.keyVersion})`;
  await q`INSERT INTO team_members (team_id, user_id, role) VALUES (${teamId}, ${adminUserId}, 'admin')`;
  for (const accountId of accountIds) {
    await q`INSERT INTO team_accounts (team_id, account_id, added_by_user_id, shared)
      VALUES (${teamId}, ${accountId}, ${adminUserId}, ${opts.shared ?? false})`;
  }
  return { teamId, adminUserId, token };
}

/**
 * チームに入る（メンバーとして）。accountIds（その人がオーナーのもの）がチームに入る。
 * @param teamId - チーム
 * @param user - 入る人の clerkUserId
 * @param accountIds - 入れるアカウント
 * @param opts - shared：入れたアカウントを見せるか
 * @returns 入った人の users.id
 */
export async function joinTeam(teamId: string, user: string, accountIds: string[], opts: { shared?: boolean } = {}) {
  const userId = await ensureUser(user);
  const q = sql();
  await q`INSERT INTO team_members (team_id, user_id, role) VALUES (${teamId}, ${userId}, 'member')`;
  for (const accountId of accountIds) {
    await q`INSERT INTO team_accounts (team_id, account_id, added_by_user_id, shared)
      VALUES (${teamId}, ${accountId}, ${userId}, ${opts.shared ?? false})`;
  }
  return userId;
}

/**
 * チームでのロールを変える（管理者にはしない。管理者の引き継ぎはAPIで確かめる）。
 * @param teamId - チーム
 * @param user - clerkUserId
 * @param role - member か editor
 */
export async function setRole(teamId: string, user: string, role: "member" | "editor") {
  const userId = await ensureUser(user);
  await sql()`UPDATE team_members SET role = ${role} WHERE team_id = ${teamId} AND user_id = ${userId}`;
}

/**
 * 担当にする（memberships の editor の行）。
 * @param teamId - チーム
 * @param user - 担当の人の clerkUserId
 * @param accountId - アカウント
 * @returns 担当の人の users.id
 */
export async function assign(teamId: string, user: string, accountId: string) {
  const userId = await ensureUser(user);
  await sql()`INSERT INTO memberships (user_id, account_id, role, team_id) VALUES (${userId}, ${accountId}, 'editor', ${teamId})`;
  return userId;
}

/**
 * 「チームに見せる」を変える。
 * @param teamId - チーム
 * @param accountId - アカウント
 * @param shared - 見せるか
 */
export async function setShared(teamId: string, accountId: string, shared: boolean) {
  await sql()`UPDATE team_accounts SET shared = ${shared} WHERE team_id = ${teamId} AND account_id = ${accountId}`;
}

/**
 * owner のアカウントを、新しいチームに入れる（各featureのテストで「チームに入っているアカウント」を作る）。
 * 管理者 admin は自分のアカウントを入れて作る。editor を渡すと、その人も自分のアカウントで入り、編集者にして担当にする。
 * @param accountId - owner のアカウント
 * @param owner - そのアカウントのオーナーの clerkUserId
 * @param opts - admin：管理者（既定 "a1"）、editor：担当の編集者、shared：owner のアカウントを見せるか
 * @returns teams.id と、編集者の users.id
 */
export async function putInTeam(
  accountId: string,
  owner: string,
  opts: { admin?: string; editor?: string; editorCreatedAt?: Date; shared?: boolean } = {},
) {
  const admin = opts.admin ?? "a1";
  const { accountId: adminAcc } = await createUserWithAccount(admin);
  const { teamId } = await makeTeam(admin, [adminAcc]);
  await joinTeam(teamId, owner, [accountId], { shared: opts.shared });
  let editorUserId: string | null = null;
  if (opts.editor) {
    const { accountId: editorAcc } = await createUserWithAccount(opts.editor, { userCreatedAt: opts.editorCreatedAt });
    editorUserId = await joinTeam(teamId, opts.editor, [editorAcc]);
    await setRole(teamId, opts.editor, "editor");
    await assign(teamId, opts.editor, accountId);
  }
  return { teamId, editorUserId };
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

/** チームの人とロール（参加の順）。 */
export async function teamMemberRows(teamId: string) {
  return (await sql()`SELECT u.clerk_user_id AS user, m.role FROM team_members m JOIN users u ON u.id = m.user_id
    WHERE m.team_id = ${teamId} ORDER BY m.joined_at, u.clerk_user_id`) as { user: string; role: string }[];
}
