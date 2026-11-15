// 招待の文字列の部品（チーム・テスト用のグループ・紹介で使う。specs/008 research.md R4、specs/016 R8、specs/017 R2）。
// 業務の判断を持たない部品なので、土台に置く（specs/meguru/029-threads-pattern1 research.md R1）。
// 文字列は推測できない乱数。照合はハッシュ、再表示は暗号化した写しで行い、平文は保存しない。
import type { Env } from "./env";
import { createTokenCipher } from "./crypto";
import { sha256Hex } from "./identifier-hash";

const PREFIX = "t_";

/**
 * 招待の文字列を作る。暗号学的乱数の base64url に接頭辞を付ける（32バイトなら43文字）。
 * @param prefix - 接頭辞（チームは「t_」、テスト用のグループは「g_」、紹介は「r_」。specs/016 research.md R8、specs/017 R2）
 * @param byteLength - 乱数のバイト数
 * @returns 招待の文字列
 */
export function newInviteToken(prefix: string = PREFIX, byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return prefix + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 招待のURL（WEB_ORIGIN/{route}/{token}）。
 * @param env - Workers のバインディング
 * @param token - 招待の文字列
 * @param route - 画面のパス（チームは「invite」、テスト用のグループは「test-invite」）
 * @returns URL
 */
export function inviteUrl(env: Env, token: string, route = "invite"): string {
  // 末尾の「/」を除いてからつなぐ（二重スラッシュにしない。PR #9 のCodexレビュー）
  return `${env.WEB_ORIGIN.replace(/\/+$/, "")}/${route}/${token}`;
}

/**
 * 招待の文字列を、保存する形（照合用のハッシュと暗号化した写し）にする。暗号の AAD にはチーム（グループ）のIDを使う。
 * @param env - Workers のバインディング
 * @param token - 招待の文字列
 * @param teamId - teams.id（テスト用のグループなら test_groups.id）
 * @returns 保存する値
 */
export async function sealInviteToken(env: Env, token: string, teamId: string) {
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  const sealed = await cipher.encrypt(token, teamId);
  return { hash: await sha256Hex(token), ciphertext: sealed.ciphertext, iv: sealed.iv, keyVersion: sealed.keyVersion };
}

/**
 * 暗号化した写しから招待の文字列を戻す。
 * @param env - Workers のバインディング
 * @param sealed - 暗号文・IV・鍵の版
 * @param teamId - teams.id（テスト用のグループなら test_groups.id）
 * @returns 招待の文字列
 */
export async function openInviteToken(
  env: Env,
  sealed: { ciphertext: Uint8Array; iv: Uint8Array; keyVersion: number },
  teamId: string,
): Promise<string> {
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  return cipher.decrypt(sealed, teamId);
}
