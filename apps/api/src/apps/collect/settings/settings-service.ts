// 主催者の既定値（specs/collect/001-event-day-collection contracts/api.md 7、FR-013、research.md R10、tasks.md T027）。
// PayPayのQRの画像（PNGかJPEG・300KB以内。画面で縮めてから送る）と、振込先の案内を、主催者ごとに1行持つ。
import { COLLECT_LIMITS, PAYPAY_QR_TYPES, type CollectSettings } from "@meguru/shared";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { collectOwnerSettings } from "../schema";

/** QRの画像の形式。 */
export type PaypayQrType = (typeof PAYPAY_QR_TYPES)[number];

/**
 * 主催者の既定値を読む（なければ空の値）。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @returns 既定値
 */
export async function getSettings(db: Db, ownerUserId: string): Promise<CollectSettings> {
  const [row] = await db
    .select({ bankText: collectOwnerSettings.bankText, hasPaypayQr: sql<boolean>`${collectOwnerSettings.paypayQr} IS NOT NULL` })
    .from(collectOwnerSettings)
    .where(eq(collectOwnerSettings.ownerUserId, ownerUserId))
    .limit(1);
  return { bankText: row?.bankText ?? null, hasPaypayQr: Boolean(row?.hasPaypayQr) };
}

/**
 * 振込先の案内を保存する（空なら消す）。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param bankText - 振込先の案内（null で消す）
 * @returns 保存したあとの既定値
 */
export async function saveBankText(db: Db, ownerUserId: string, bankText: string | null): Promise<CollectSettings> {
  const now = new Date();
  await db
    .insert(collectOwnerSettings)
    .values({ ownerUserId, bankText, updatedAt: now })
    .onConflictDoUpdate({ target: collectOwnerSettings.ownerUserId, set: { bankText, updatedAt: now } });
  return getSettings(db, ownerUserId);
}

/**
 * 画像の頭の数バイトが、その形式のものかを確かめる（形式の名前だけを偽った本文を入れない）。
 * @param bytes - 画像
 * @param type - 形式
 * @returns 合っていれば true
 */
export function matchesImageType(bytes: Uint8Array, type: PaypayQrType): boolean {
  if (type === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b);
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * QRの画像を確かめる。300KBを超えたら 413 IMAGE_TOO_LARGE、形式が違えば 400 VALIDATION_FAILED。
 * @param contentType - 本文の形式（Content-Type）
 * @param bytes - 画像
 * @returns 形式
 */
export function validateQrImage(contentType: string | undefined, bytes: Uint8Array): PaypayQrType {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (!(PAYPAY_QR_TYPES as readonly string[]).includes(type)) {
    throw new AppError("VALIDATION_FAILED", 400, "unsupported image type", undefined, ["image"]);
  }
  if (bytes.byteLength > COLLECT_LIMITS.paypayQrBytes) throw new AppError("IMAGE_TOO_LARGE", 413, "image too large");
  if (bytes.byteLength === 0 || !matchesImageType(bytes, type as PaypayQrType)) {
    throw new AppError("VALIDATION_FAILED", 400, "invalid image", undefined, ["image"]);
  }
  return type as PaypayQrType;
}

/**
 * QRの画像を保存する。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param bytes - 確かめた画像
 * @param type - 形式
 */
export async function saveQr(db: Db, ownerUserId: string, bytes: Uint8Array, type: PaypayQrType): Promise<void> {
  const now = new Date();
  await db
    .insert(collectOwnerSettings)
    .values({ ownerUserId, paypayQr: bytes, paypayQrType: type, updatedAt: now })
    .onConflictDoUpdate({ target: collectOwnerSettings.ownerUserId, set: { paypayQr: bytes, paypayQrType: type, updatedAt: now } });
}

/**
 * QRの画像を読む。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @returns 画像と形式（なければ null）
 */
export async function loadQr(db: Db, ownerUserId: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const [row] = await db
    .select({ bytes: collectOwnerSettings.paypayQr, type: collectOwnerSettings.paypayQrType })
    .from(collectOwnerSettings)
    .where(eq(collectOwnerSettings.ownerUserId, ownerUserId))
    .limit(1);
  return row?.bytes && row.type ? { bytes: row.bytes, type: row.type } : null;
}

/**
 * QRの画像を消す（振込先の案内は残す）。
 * @param db - データベース
 * @param ownerUserId - 主催者
 */
export async function deleteQr(db: Db, ownerUserId: string): Promise<void> {
  await db
    .update(collectOwnerSettings)
    .set({ paypayQr: null, paypayQrType: null, updatedAt: new Date() })
    .where(eq(collectOwnerSettings.ownerUserId, ownerUserId));
}
