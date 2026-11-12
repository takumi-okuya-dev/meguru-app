// 暗号鍵のローテーション（research.md R5 の手順3・4）。
// 古いバージョンの行を、IVを新しく作って現在の鍵で暗号化し直す。
// 各行の書き込みは、読んだ時点の key_version と accounts.connection_generation を条件にし、
// その間に再接続などで書き換わった行は飛ばす（トークンの値は変わらないので世代番号は上げない）。
// 組み立て（docs/module-map.md 2-5）に置く：共通（テストのグループの招待のトークン）とThreads（チームの招待のトークン・接続のトークン）の両方の暗号を入れ替えるため（specs/027・specs/meguru/029）。
import { and, eq, ne, sql } from "drizzle-orm";
import type { Env } from "../kernel/env";
import { createDb } from "../kernel/db/client";
import { accounts, teams, testGroups, threadsConnections } from "../db/schema";
import { createTokenCipher, KeyRingError } from "../kernel/crypto";

/**
 * 暗号鍵のローテーション（research.md R5 の手順3・4）。古いバージョンの行を、新しいIVと現在の鍵で暗号化し直す。
 * 各行の書き込みは key_version と connection_generation を条件にし、その間に書き換わった行は飛ばす。
 * チームの招待リンクの暗号化した写し（teams。specs/011 data-model.md、仕組みは specs/008 research.md R4）も同じ鍵なので、
 * 不足の検査・暗号化し直し・残りの件数に含める。テストのグループの招待リンク（test_groups。specs/016 research.md R8）も同じ鍵なので同じに扱う。
 * 招待は、読んだ時点の照合用ハッシュと鍵のバージョンを条件にする（作り直された・先に入れ替えられた行は飛ばす）。
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
    ...(await db.selectDistinct({ v: teams.inviteKeyVersion }).from(teams)),
    ...(await db.selectDistinct({ v: testGroups.inviteKeyVersion }).from(testGroups)),
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

  // チームの招待リンク（AAD は teamId）
  const teamInvites = await db.select().from(teams).where(ne(teams.inviteKeyVersion, cipher.currentVersion));
  for (const team of teamInvites) {
    const plaintext = await cipher.decrypt(
      { ciphertext: team.inviteTokenCiphertext, iv: team.inviteTokenIv, keyVersion: team.inviteKeyVersion },
      team.id,
    );
    const enc = await cipher.encrypt(plaintext, team.id);
    const updated = await db
      .update(teams)
      .set({ inviteTokenCiphertext: enc.ciphertext, inviteTokenIv: enc.iv, inviteKeyVersion: enc.keyVersion })
      // 読んだ時点の照合用ハッシュと鍵のバージョンを条件にする（作り直された・先に入れ替えられた行は飛ばす。PR #9 のCodexレビュー）
      .where(
        and(
          eq(teams.id, team.id),
          eq(teams.inviteTokenHash, team.inviteTokenHash),
          eq(teams.inviteKeyVersion, team.inviteKeyVersion),
        ),
      )
      .returning({ id: teams.id });
    if (updated.length > 0) rotated += 1;
    else skipped += 1;
  }

  // テストのグループの招待リンク（AAD は groupId。チームの招待と同じ作り。specs/016 research.md R8）
  const groupInvites = await db.select().from(testGroups).where(ne(testGroups.inviteKeyVersion, cipher.currentVersion));
  for (const group of groupInvites) {
    const plaintext = await cipher.decrypt(
      { ciphertext: group.inviteTokenCiphertext, iv: group.inviteTokenIv, keyVersion: group.inviteKeyVersion },
      group.id,
    );
    const enc = await cipher.encrypt(plaintext, group.id);
    const updated = await db
      .update(testGroups)
      .set({ inviteTokenCiphertext: enc.ciphertext, inviteTokenIv: enc.iv, inviteKeyVersion: enc.keyVersion })
      .where(
        and(
          eq(testGroups.id, group.id),
          eq(testGroups.inviteTokenHash, group.inviteTokenHash),
          eq(testGroups.inviteKeyVersion, group.inviteKeyVersion),
        ),
      )
      .returning({ id: testGroups.id });
    if (updated.length > 0) rotated += 1;
    else skipped += 1;
  }

  const [remaining] = await db
    .select({
      n: sql<number>`(
        (SELECT count(*) FROM ${threadsConnections} WHERE ${threadsConnections.keyVersion} <> ${cipher.currentVersion})
        + (SELECT count(*) FROM ${teams} WHERE ${teams.inviteKeyVersion} <> ${cipher.currentVersion})
        + (SELECT count(*) FROM ${testGroups} WHERE ${testGroups.inviteKeyVersion} <> ${cipher.currentVersion})
      )::int`,
    })
    .from(sql`(SELECT 1) AS one`);
  return { rotated, skipped, remainingOldVersionRows: remaining?.n ?? 0 };
}
