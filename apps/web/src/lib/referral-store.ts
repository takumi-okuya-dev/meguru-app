// 紹介リンクを開いたことを、このブラウザに30日だけ覚える（specs/017-referral-links research.md R3、contracts/ui-routes.md 3）。
// Googleのログインで別のサイトを行き来するので、登録まで URL では運べない。登録が終わる（me が成功する）と消す。
// 覚えられない環境（プライベートブラウズなど）では何もしない（紹介の記録がつかないだけ）。
import { REFERRAL_CODE_PATTERN, REFERRAL_REMEMBER_DAYS } from "@meguru/shared";

const KEY = "tg.referral";
const REMEMBER_MS = REFERRAL_REMEMBER_DAYS * 24 * 60 * 60 * 1000;

/**
 * 紹介リンクを開いたことを覚える。あとから開いた方で上書きする（FR-006）。
 * @param code - 紹介の文字列（形に合わなければ覚えない）
 */
export function rememberReferral(code: string) {
  if (!REFERRAL_CODE_PATTERN.test(code)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: new Date().toISOString() }));
  } catch {
    // 覚えられない環境では何もしない
  }
}

/**
 * 覚えている紹介の文字列。30日を過ぎていれば消して null。
 * @returns 紹介の文字列。なければ null
 */
export function currentReferral(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw) as { code?: unknown; at?: unknown };
    const at = typeof v.at === "string" ? Date.parse(v.at) : NaN;
    // 未来の時刻（端末の時計が進んでいたとき）は、いつまでも残らないよう捨てる
    const age = Date.now() - at;
    if (typeof v.code === "string" && REFERRAL_CODE_PATTERN.test(v.code) && age >= 0 && age <= REMEMBER_MS) return v.code;
    localStorage.removeItem(KEY);
    return null;
  } catch {
    return null;
  }
}

/** 覚えている紹介の文字列を消す（登録が終わったとき）。 */
export function clearReferral() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 消せない環境では何もしない
  }
}
