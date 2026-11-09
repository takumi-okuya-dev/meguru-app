// プロンプトの材料を最後に変えた日時（specs/006-performance-feedback FR-002g、research.md R9）。
// 宣伝内容・リサーチの追加・変更・削除の後に呼ぶ。分析のための記録なので、失敗しても元の操作は失敗にしない（ログに出す）。
import { eq } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { accounts } from "../../../platform";
import { logger } from "../../../kernel/logger";

/**
 * 材料を変えた日時を今にする。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param kind - promotions（宣伝内容）か research（参考の投稿・キーワード）
 * @param now - 今
 */
export async function touchMaterials(db: Db, accountId: string, kind: "promotions" | "research", now: Date = new Date()) {
  try {
    await db
      .update(accounts)
      .set(kind === "promotions" ? { promotionsChangedAt: now } : { researchChangedAt: now })
      .where(eq(accounts.id, accountId));
  } catch (err) {
    logger.warn("failed to record materials change", { accountId, kind, err });
  }
}
