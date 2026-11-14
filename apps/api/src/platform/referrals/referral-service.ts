// 紹介リンク（specs/017-referral-links research.md R1〜R6）。
// 紹介の列（users.referral_code・referred_by_user_id・referred_at）は、このファイルと、行を作る認証のミドルウェアだけが書く。
// 紹介の記録は、料金・使える状態・権限・テスト版に入れるかの判定に使わない（FR-008）。
import { REFERRAL_CODE_PATTERN, type ReferralResponse } from "@meguru/shared";
import { and, count, eq, isNull } from "drizzle-orm";
import type { Env } from "../../kernel/env";
import { createDb, type Db } from "../../kernel/db/client";
import { users } from "../schema";
import { pgErrorCode } from "../../kernel/errors";
import { inviteUrl, newInviteToken } from "../../kernel/invite-token";

/**
 * 紹介の文字列を作る。16バイトの暗号学的乱数の base64url（22文字）に「r_」を付ける（research.md R2）。
 * @returns 紹介の文字列
 */
export const newReferralCode = (): string => newInviteToken("r_", 16);

/**
 * 紹介の文字列から、持ち主の users.id を引く。形に合わない・持ち主がいない・持ち主が退会の途中なら null
 * （エラーにしない。research.md R4、FR-005）。
 * @param db - データベース
 * @param code - X-Referral-Code の値
 * @returns 持ち主の users.id
 */
export async function referrerIdByCode(db: Db, code: string | undefined): Promise<string | null> {
  if (!code || !REFERRAL_CODE_PATTERN.test(code)) return null;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.referralCode, code), isNull(users.withdrawalRequestedAt)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * 本人の紹介リンクと、紹介で登録した人数（FR-002・FR-007）。紹介の文字列がまだなければ作って保存する。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @returns 紹介リンクと人数
 */
export async function referralOf(env: Env, userId: string): Promise<ReferralResponse> {
  const db = createDb(env.DATABASE_URL);
  // 退会の途中の人は、退会が終わると行ごと消えるので、今から数えない
  const [code, [row]] = await Promise.all([
    ensureReferralCode(db, userId),
    db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.referredByUserId, userId), isNull(users.withdrawalRequestedAt))),
  ]);
  return { url: inviteUrl(env, code, "r"), referredCount: Number(row?.n ?? 0) };
}

/**
 * 紹介の文字列を読み、なければ作る。同時に開いても1つに決まるよう、NULLのときだけ書き、書けなければ読み直す。
 * @param db - データベース
 * @param userId - users.id
 * @returns 紹介の文字列
 */
async function ensureReferralCode(db: Db, userId: string): Promise<string> {
  for (let i = 0; i < 3; i++) {
    const [current] = await db.select({ code: users.referralCode }).from(users).where(eq(users.id, userId));
    if (current?.code) return current.code;
    try {
      const [written] = await db
        .update(users)
        .set({ referralCode: newReferralCode() })
        .where(and(eq(users.id, userId), isNull(users.referralCode)))
        .returning({ code: users.referralCode });
      if (written?.code) return written.code;
    } catch (err) {
      // ほかの人の文字列とぶつかった（ほぼ起きない）。作り直す
      if (pgErrorCode(err) !== "23505") throw err;
    }
  }
  throw new Error("could not assign a referral code");
}
