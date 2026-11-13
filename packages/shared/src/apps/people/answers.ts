// アンケートの答えの読み方（specs/people/001-people-memo research.md R7・R8）。
import { questionKey } from "./names";

/** 同意の選択肢の目的。invite：交流会への誘い。work：仕事の相談先へのつなぎ。decline：個別の案内は希望しない。ignore：同意に関わらない。 */
export const CONSENT_PURPOSES = ["invite", "work", "decline", "ignore"] as const;
/** 同意の選択肢の目的。 */
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** 目的ごとの同意。 */
export type Consent = { invite: boolean; work: boolean };

/** 複数選択の答えの区切り：カンマと空白（Googleのスプレッドシートの書き出し）・読点・全角のカンマ。 */
const CHOICE_SEPARATOR = /,\s+|、|，/u;

/**
 * 複数選択の答えを、選んだものごとに分ける（R7）。前後の空白を外し、空を捨てる。フォームにない「その他」の自由記述は1つの値で残る。
 * @param value - 答えの文字（空でもよい）
 * @returns 選んだもの
 */
export function splitChoices(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(CHOICE_SEPARATOR)
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/** 日本時間との差。 */
const JST_OFFSET_MS = 9 * 3600_000;
/** 回答の時刻の形：2026/10/11 21:03:12・2026-10-11 21:03:12（秒は省いてもよい）。 */
const SUBMITTED_AT = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * 回答の時刻（Googleの書き出しのタイムスタンプ）を、日本時間として読む（R8）。
 * @param value - タイムスタンプの文字
 * @returns 時刻。読めない形なら null
 */
export function parseSubmittedAt(value: string | null | undefined): Date | null {
  const m = SUBMITTED_AT.exec((value ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s) - JST_OFFSET_MS;
  const check = new Date(utc + JST_OFFSET_MS);
  // 2月30日のような日付は読めないものにする
  if (check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return null;
  return new Date(utc);
}

/**
 * 1つの回答の、目的ごとの同意を決める（R7）。「希望しない」（decline）の選択肢が1つでもあれば、どちらも「なし」（慎重な方に倒す）。
 * そうでなければ、invite があれば交流会への誘い、work があれば仕事のつなぎの同意。答えが空ならどちらも「なし」（FR-009）。
 * @param choices - 選んだもの（splitChoices の結果）
 * @param purposes - 選択肢の鍵（questionKey）→ 目的
 * @returns 目的ごとの同意
 */
export function consentFromChoices(choices: readonly string[], purposes: ReadonlyMap<string, ConsentPurpose>): Consent {
  const found = choices.map((c) => purposes.get(questionKey(c)));
  if (found.includes("decline")) return { invite: false, work: false };
  return { invite: found.includes("invite"), work: found.includes("work") };
}
