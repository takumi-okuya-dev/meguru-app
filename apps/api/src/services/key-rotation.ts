// 暗号鍵のローテーション（research.md R5 の手順3・4）。
// 古いバージョンの行を、IVを新しく作って現在の鍵で暗号化し直す。
// 各行の書き込みは、読んだ時点の key_version と accounts.connection_generation を条件にし、
// その間に再接続などで書き換わった行は飛ばす（トークンの値は変わらないので世代番号は上げない）。
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { Env } from "../env";
import { createDb } from "../db/client";
import { accountPartnerInvites, accounts, teams, threadsConnections } from "../db/schema";
import { createTokenCipher, KeyRingError } from "../lib/crypto";

/**
 * 暗号鍵のローテーション（research.md R5 の手順3・4）。古いバージョンの行を、新しいIVと現在の鍵で暗号化し直す。
 * 各行の書き込みは key_version と connection_generation を条件にし、その間に書き換わった行は飛ばす。
 * 招待リンクの暗号化した写し（account_partner_invites・teams の編集者の招待。specs/008 research.md R4）も同じ鍵なので、
 * 不足の検査・暗号化し直し・残りの件数に含める。招待は、読んだ時点の照合用ハッシュと鍵のバージョンを条件にする（作り直された・先に入れ替えられた行は飛ばす）。
 * @param env - バインディング（鍵リング・現在のバージョン・DATABASE_URL）
 * @returns 暗号化し直した件数、飛ばした件数、旧バージョンの残りの件数
 * @throws KeyRingError 鍵が欠けているバージョンの行があるとき（開始しない）
 */
export async function rotateTokenKeys(env: Env) {
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  const ring = JSON.parse(env.TOKEN_ENCRYPTION_KEYS) as Record<string, string>;
  const db = createDb(env.DATABASE_URL);

  // 鍵が欠けているバージョンの行があれば開始しない
  const versions = [
    ...(await db.selectDistinct({ v: threadsConnections.keyVersion }).from(threadsConnections)),
    ...(await db.selectDistinct({ v: accountPartnerInvites.keyVersion }).from(accountPartnerInvites)),
    ...(await db
      .selectDistinct({ v: teams.editorInviteKeyVersion })
      .from(teams)
      .where(isNotNull(teams.editorInviteKeyVersion))),
  ];
  const missing = [...new Set(versions.map((r) => r.v))].filter((v) => v !== null && !(String(v) in ring));
  if (missing.length > 0) {
    throw new KeyRingError(`key ring is missing versions used by existing rows: ${missing.join(", ")}`);
  }

  const rows = await db
    .select({ conn: threadsConnections, generation: accounts.connectionGeneration })
    .from(threadsConnections)
    .innerJoin(accounts, eq(accounts.id, threadsConnections.accountId))
    .where(ne(threadsConnections.keyVersion, cipher.currentVersion));

  let rotated = 0;
  let skipped = 0;
  for (const { conn, generation } of rows) {
    const plaintext = await cipher.decrypt(
      { ciphertext: conn.accessTokenCiphertext, iv: conn.accessTokenIv, keyVersion: conn.keyVersion },
      conn.accountId,
    );
    const enc = await cipher.encrypt(plaintext, conn.accountId);
    const updated = await db
      .update(threadsConnections)
      .set({ accessTokenCiphertext: enc.ciphertext, accessTokenIv: enc.iv, keyVersion: enc.keyVersion, updatedAt: new Date() })
      .where(
        and(
          eq(threadsConnections.accountId, conn.accountId),
          eq(threadsConnections.keyVersion, conn.keyVersion),
          sql`EXISTS (SELECT 1 FROM ${accounts} WHERE ${accounts.id} = ${conn.accountId} AND ${accounts.connectionGeneration} = ${generation})`,
        ),
      )
      .returning({ id: threadsConnections.accountId });
    if (updated.length > 0) rotated += 1;
    else skipped += 1;
  }

  // パートナーの招待リンク（AAD は accountId）
  const partnerInvites = await db
    .select()
    .from(accountPartnerInvites)
    .where(ne(accountPartnerInvites.keyVersion, cipher.currentVersion));
  for (const inv of partnerInvites) {
    const plaintext = await cipher.decrypt(
      { ciphertext: inv.tokenCiphertext, iv: inv.tokenIv, keyVersion: inv.keyVersion },
      inv.accountId,
    );
    const enc = await cipher.encrypt(plaintext, inv.accountId);
    const updated = await db
      .update(accountPartnerInvites)
      .set({ tokenCiphertext: enc.ciphertext, tokenIv: enc.iv, keyVersion: enc.keyVersion })
      // 読んだ時点の鍵のバージョンも条件にする（別の入れ替えが先に新しい鍵へ移した行を、古い鍵で上書きしない。PR #9 のCodexレビュー）
      .where(
        and(
          eq(accountPartnerInvites.accountId, inv.accountId),
          eq(accountPartnerInvites.tokenHash, inv.tokenHash),
          eq(accountPartnerInvites.keyVersion, inv.keyVersion),
        ),
      )
      .returning({ id: accountPartnerInvites.accountId });
    if (updated.length > 0) rotated += 1;
    else skipped += 1;
  }

  // 編集者の招待リンク（AAD は teamId）
  const teamInvites = await db
    .select()
    .from(teams)
    .where(and(isNotNull(teams.editorInviteKeyVersion), ne(teams.editorInviteKeyVersion, cipher.currentVersion)));
  for (const team of teamInvites) {
    const plaintext = await cipher.decrypt(
      { ciphertext: team.editorInviteTokenCiphertext!, iv: team.editorInviteTokenIv!, keyVersion: team.editorInviteKeyVersion! },
      team.id,
    );
    const enc = await cipher.encrypt(plaintext, team.id);
    const updated = await db
      .update(teams)
      .set({ editorInviteTokenCiphertext: enc.ciphertext, editorInviteTokenIv: enc.iv, editorInviteKeyVersion: enc.keyVersion })
      .where(
        and(
          eq(teams.id, team.id),
          eq(teams.editorInviteTokenHash, team.editorInviteTokenHash!),
          eq(teams.editorInviteKeyVersion, team.editorInviteKeyVersion!),
        ),
      )
      .returning({ id: teams.id });
    if (updated.length > 0) rotated += 1;
    else skipped += 1;
  }

  const [remaining] = await db
    .select({
      n: sql<number>`(
        (SELECT count(*) FROM ${threadsConnections} WHERE ${threadsConnections.keyVersion} <> ${cipher.currentVersion})
        + (SELECT count(*) FROM ${accountPartnerInvites} WHERE ${accountPartnerInvites.keyVersion} <> ${cipher.currentVersion})
        + (SELECT count(*) FROM ${teams} WHERE ${teams.editorInviteKeyVersion} IS NOT NULL AND ${teams.editorInviteKeyVersion} <> ${cipher.currentVersion})
      )::int`,
    })
    .from(sql`(SELECT 1) AS one`);
  return { rotated, skipped, remainingOldVersionRows: remaining?.n ?? 0 };
}
