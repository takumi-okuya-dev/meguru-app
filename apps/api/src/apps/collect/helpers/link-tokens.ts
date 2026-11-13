// 受付用リンクのトークンの鍵の入れ替え（specs/collect/001-event-day-collection research.md R7）。共通の鍵（TOKEN_ENCRYPTION_KEYS）で
// 暗号化して持つので、組み立ての鍵の入れ替え（jobs/key-rotation.ts）が、アプリの入口の tokenKeys からこれを呼ぶ。
// 止めたリンクは出し直さないので、使えるリンク（stopped_at が空）だけを数え、暗号化し直す。AAD はイベントの番号。
import { and, count, eq, isNull, ne } from "drizzle-orm";
import { createDb } from "../../../kernel/db/client";
import type { AppTokenKeys } from "../../../platform";
import { collectReceptionLinks } from "../schema";

const active = isNull(collectReceptionLinks.stoppedAt);

/** 受付用リンクの鍵の入れ替え。 */
export const receptionLinkTokenKeys: AppTokenKeys = {
  versionsInUse: async (env) => {
    const rows = await createDb(env.DATABASE_URL).selectDistinct({ v: collectReceptionLinks.tokenKeyVersion }).from(collectReceptionLinks).where(active);
    return rows.map((r) => r.v);
  },
  rotate: async (env, cipher) => {
    const db = createDb(env.DATABASE_URL);
    const links = await db
      .select()
      .from(collectReceptionLinks)
      .where(and(active, ne(collectReceptionLinks.tokenKeyVersion, cipher.currentVersion)));
    let rotated = 0;
    let skipped = 0;
    for (const link of links) {
      const plaintext = await cipher.decrypt({ ciphertext: link.tokenCiphertext, iv: link.tokenIv, keyVersion: link.tokenKeyVersion }, link.eventId);
      const enc = await cipher.encrypt(plaintext, link.eventId);
      // 読んだ時点の鍵の版を条件にする（先に入れ替えられた行は飛ばす）
      const updated = await db
        .update(collectReceptionLinks)
        .set({ tokenCiphertext: enc.ciphertext, tokenIv: enc.iv, tokenKeyVersion: enc.keyVersion })
        .where(and(eq(collectReceptionLinks.id, link.id), eq(collectReceptionLinks.tokenKeyVersion, link.tokenKeyVersion)))
        .returning({ id: collectReceptionLinks.id });
      if (updated.length > 0) rotated += 1;
      else skipped += 1;
    }
    return { rotated, skipped };
  },
  remaining: async (env, currentVersion) => {
    const [row] = await createDb(env.DATABASE_URL)
      .select({ n: count() })
      .from(collectReceptionLinks)
      .where(and(active, ne(collectReceptionLinks.tokenKeyVersion, currentVersion)));
    return Number(row?.n ?? 0);
  },
};
