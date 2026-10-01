// 暗号鍵のローテーション（research.md R5 の手順3・4）。
// 古いバージョンの行を、IVを新しく作って現在の鍵で暗号化し直す。
// 各行の書き込みは、読んだ時点の key_version と accounts.connection_generation を条件にし、
// その間に再接続などで書き換わった行は飛ばす（トークンの値は変わらないので世代番号は上げない）。
import { and, eq, ne, sql } from "drizzle-orm";
import type { Env } from "../env";
import { createDb } from "../db/client";
import { accounts, threadsConnections } from "../db/schema";
import { createTokenCipher, KeyRingError } from "../lib/crypto";

export async function rotateTokenKeys(env: Env) {
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  const ring = JSON.parse(env.TOKEN_ENCRYPTION_KEYS) as Record<string, string>;
  const db = createDb(env.DATABASE_URL);

  // 鍵が欠けているバージョンの行があれば開始しない
  const versions = await db.selectDistinct({ v: threadsConnections.keyVersion }).from(threadsConnections);
  const missing = versions.map((r) => r.v).filter((v) => !(String(v) in ring));
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

  const [remaining] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(threadsConnections)
    .where(ne(threadsConnections.keyVersion, cipher.currentVersion));
  return { rotated, skipped, remainingOldVersionRows: remaining?.n ?? 0 };
}
