// 課題の読み書き（specs/002-strategy-profile research.md R1〜R3）。
// 全項目をまとめて置き換え、version が一致する場合だけ保存する。
import type { AccountAccess } from "./access";
import { recordActivity, updatedByOf } from "./activity-log";
import {
  STRATEGY_TEXT_KEYS,
  STRATEGY_TOTAL,
  countFilled,
  emptyStrategyValues,
  isBlank,
  type PutStrategyRequest,
  type StrategyValues,
} from "@threads-grower/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { strategyDesigns } from "../db/schema";
import { AppError } from "../lib/errors";

type StrategyRow = typeof strategyDesigns.$inferSelect;

/** 課題のレスポンス（canEdit を除く）。 */
export type StrategyBody = StrategyValues & {
  version: number;
  filledCount: number;
  totalCount: typeof STRATEGY_TOTAL;
  updatedAt: string | null;
};

function toBody(row: StrategyRow | undefined): StrategyBody {
  const values = emptyStrategyValues();
  if (row) {
    // DB の NULL はレスポンスで "" にする（research.md R2）
    for (const k of STRATEGY_TEXT_KEYS) values[k] = row[k] ?? "";
    values.tonePreset = row.tonePreset;
  }
  return {
    ...values,
    version: row?.version ?? 0,
    filledCount: countFilled(values),
    totalCount: STRATEGY_TOTAL,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}

/**
 * 空白だけの値は NULL にし、それ以外は入力されたまま保存する（research.md R2）。
 * @param req - 課題の値
 * @returns 列の値
 */
function toColumns(req: StrategyValues) {
  const cols = Object.fromEntries(STRATEGY_TEXT_KEYS.map((k) => [k, isBlank(req[k]) ? null : req[k]])) as Record<
    (typeof STRATEGY_TEXT_KEYS)[number],
    string | null
  >;
  return { ...cols, tonePreset: req.tonePreset };
}

async function findRow(db: Db, accountId: string) {
  const [row] = await db.select().from(strategyDesigns).where(eq(strategyDesigns.accountId, accountId)).limit(1);
  return row;
}

/**
 * 課題を返す。まだ保存していなければ、全項目が空・version 0・updatedAt null。
 * @param db - データベース
 * @param accountId - accounts.id（所有の確認は呼び出し側で済ませる）
 * @returns 課題
 */
export async function getStrategy(db: Db, accountId: string): Promise<StrategyBody> {
  return toBody(await findRow(db, accountId));
}

/**
 * 課題の全項目をまとめて保存する（research.md R3）。
 * - expectedVersion = 0：行がなければ作る。別のタブが先に作っていれば 409。
 * - expectedVersion ≥ 1：version が一致する場合だけ更新する。一致しない・行がない（消された）なら 409。
 * @param db - データベース
 * @param accountId - accounts.id（所有と grower機能の確認は呼び出し側で済ませる）
 * @param req - 全項目の値と expectedVersion
 * @param access - 操作した人（操作の記録と、保存した人に使う。specs/008）。省略すると記録しない
 * @returns 保存後の課題
 * @throws AppError STALE_UPDATE（latest に最新の課題）
 */
export async function saveStrategy(
  db: Db,
  accountId: string,
  req: PutStrategyRequest,
  access?: AccountAccess,
): Promise<StrategyBody> {
  const cols = { ...toColumns(req), ...(access ? { updatedByUserId: access.actor.id } : {}) };
  let saved: StrategyRow | undefined;
  if (req.expectedVersion === 0) {
    [saved] = await db
      .insert(strategyDesigns)
      .values({ accountId, ...cols })
      .onConflictDoNothing({ target: strategyDesigns.accountId })
      .returning();
  } else {
    [saved] = await db
      .update(strategyDesigns)
      .set({ ...cols, version: req.expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(strategyDesigns.accountId, accountId), eq(strategyDesigns.version, req.expectedVersion)))
      .returning();
  }
  if (saved) {
    if (access) await recordActivity(db, access, { kind: "content", action: "strategy_saved" });
    return toBody(saved);
  }
  // 他で先に保存された（または行が消えた）。最新の課題を latest に入れて 409。
  // GET と同じ形にするため canEdit も入れる（保存は grower機能を確かめた後にだけ呼ぶので true）
  const current = await findRow(db, accountId);
  // 先に保存した人の名前を添える（specs/008 FR-007）
  throw new AppError(
    "STALE_UPDATE",
    409,
    "updated elsewhere",
    { ...toBody(current), canEdit: true },
    undefined,
    { updatedBy: await updatedByOf(db, current?.updatedByUserId) },
  );
}
