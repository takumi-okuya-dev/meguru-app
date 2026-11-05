// 時間差のメンション（specs/023-delayed-mention data-model.md「共有の関数」、research.md R3・R6）。APIとWebで同じ決まりを使う。

/** 出せなかった理由。 */
export const MENTION_FAILURE_REASONS = ["not_found", "post_failed", "no_permission", "expired", "ng_word", "limit", "error"] as const;
/** 出せなかった理由。 */
export type MentionFailureReason = (typeof MENTION_FAILURE_REASONS)[number];
/** 時間差のメンションの状態。 */
export const MENTION_STATES = ["pending", "sent", "canceled", "failed"] as const;
/** 時間差のメンションの状態。 */
export type MentionState = (typeof MENTION_STATES)[number];

/** 出せなかった理由の表示名（spec FR-023）。 */
export const MENTION_FAILURE_LABELS: Record<MentionFailureReason, string> = {
  not_found: "投稿が見つかりません",
  post_failed: "投稿されませんでした",
  no_permission: "返信の権限がありません",
  expired: "時間が過ぎました",
  ng_word: "NGワード",
  limit: "同じ人へのメンションが多すぎます",
  error: "Threadsが受け付けませんでした",
};

const USERNAME_RE = /^[a-z0-9._]{1,30}$/;
const MENTION_RE = /@([A-Za-z0-9._]{1,30})/g;

/**
 * Threadsのユーザー名をそろえる（前後の空白と先頭の@を外して小文字にする）。
 * @param s - 入力
 * @returns ユーザー名。形が違えば null
 */
export function normalizeMentionUsername(s: string): string | null {
  const v = s.trim().replace(/^[@＠]/, "").toLowerCase();
  return USERNAME_RE.test(v) ? v : null;
}

/**
 * 返信の文（ひとこと、改行、@a @b）。ひとことが空なら @a @b だけ。
 * @param message - ひとこと
 * @param usernames - 選んだ人（@なし）
 * @returns 返信の文
 */
export function buildMentionText(message: string, usernames: readonly string[]): string {
  const names = usernames.map((u) => `@${u}`).join(" ");
  const head = message.trim();
  return head === "" ? names : `${head}\n${names}`;
}

/**
 * 文の中の @ユーザー名 のうち、一覧にある人（大文字・小文字をそろえ、重なりなし、文の順。spec FR-011）。
 * @param text - 返信の文
 * @param people - 一覧のユーザー名（@なし・小文字）
 * @returns 一覧にある人
 */
export function mentionUsernamesIn(text: string, people: readonly string[]): string[] {
  const known = new Set(people);
  const out: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const u = m[1]!.toLowerCase();
    if (known.has(u) && !out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * 文の @ユーザー名 を足す・消す（丸いボタン）。あれば消し、なければ最後の行に足す（最後の行に @ がなければ行を足す）。
 * @param text - 返信の文
 * @param username - ユーザー名（@なし）
 * @returns 新しい文
 */
export function toggleMentionInText(text: string, username: string): string {
  const re = new RegExp(`(^|\\s)@${username.replace(/\./g, "\\.")}(?![A-Za-z0-9._])`, "gi");
  if (re.test(text)) {
    // 消した行は詰め、消して空になった行は消す（ほかの空の行は残す）
    const lines = text.split("\n").flatMap((l) => {
      const removed = l.replace(re, "$1");
      if (removed === l) return [l];
      const t = removed.replace(/[ \t]{2,}/g, " ").trim();
      return t === "" ? [] : [t];
    });
    return lines.join("\n").trim();
  }
  const lines = text.replace(/\s+$/, "").split("\n");
  const last = lines.at(-1) ?? "";
  if (text.trim() !== "" && last.includes("@")) lines[lines.length - 1] = `${last} @${username}`;
  else if (text.trim() === "") return `@${username}`;
  else lines.push(`@${username}`);
  return lines.join("\n");
}

/**
 * 返信の時刻（research.md R3）。投稿済みの投稿に付けたものは押した時刻、ほかは投稿の時刻＋時間差。
 * @param m - delayMinutes：付けたときの時間差、sendAfter：「返信する」を押した時刻
 * @param publishedAt - 投稿した日時（投稿の前なら null）
 * @returns 返信の時刻。決まらなければ null
 */
export function mentionDueAt(
  m: { delayMinutes: number | null; sendAfter: Date | string | null },
  publishedAt: Date | string | null,
): Date | null {
  if (m.sendAfter) return new Date(m.sendAfter);
  if (!publishedAt || m.delayMinutes === null) return null;
  return new Date(new Date(publishedAt).getTime() + m.delayMinutes * 60_000);
}
