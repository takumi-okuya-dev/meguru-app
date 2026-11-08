// 投稿の時刻と予定の計算（specs/005-auto-post research.md R1・R2・R9）。
// 日本時間は UTC＋9時間の固定の差で扱う（夏時間はない）。ずらした時刻は保存せず、同じ入力から毎回同じ値を求める。
import {
  AUTOPOST_JITTER_SECONDS,
  AUTOPOST_LATE_WINDOW_MINUTES,
  AUTOPOST_MIN_GAP_MINUTES,
  AUTOPOST_SLOT_LIMIT,
  LATE_NIGHT_HINT_MINUTES,
} from "./limits";

/** 日本時間とUTCの差（ミリ秒）。 */
export const JST_OFFSET_MS = 9 * 3600_000;
const DAY_MS = 86_400_000;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * "HH:MM" を0時からの分にする。
 * @param time - "HH:MM"（00:00〜23:59）
 * @returns 0〜1439。形が誤っていれば null
 */
export function timeToMinutes(time: string): number | null {
  const m = TIME_PATTERN.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * 0時からの分を "HH:MM" にする。
 * @param minutes - 0〜1439
 * @returns "HH:MM"
 */
export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 投稿の設定の検証の入力。 */
export type PostingScheduleInput = { enabled: boolean; slotTimes: string[]; jitter: boolean };

/** 投稿の設定の検証で通らなかった理由。 */
export type PostingScheduleProblem = "invalid_time" | "too_many" | "duplicate" | "required" | "too_close";

/** 投稿の設定の検証の結果。 */
export type PostingScheduleValidation =
  | { ok: true; slotMinutes: number[] }
  | { ok: false; reason: PostingScheduleProblem; times?: string[] };

/**
 * 投稿の設定を検証する（FR-001・FR-001a・FR-002）。WebとAPIで同じものを使う。
 * 確かめる順は、時刻の形 → 件数 → 重複 → オンなら1件以上 → ずらすなら30分以上の間。
 * @param input - オン・オフ、時刻の一覧（"HH:MM"）、ずらすか
 * @param opts - maxSlots：時刻の数の上限（オーナーの1日の投稿数の上限。省けば既定値の10件）
 * @returns 通れば昇順の分の一覧、通らなければ理由と、該当する時刻
 */
export function validatePostingSchedule(
  input: PostingScheduleInput,
  opts: { maxSlots?: number } = {},
): PostingScheduleValidation {
  // 時刻の数の上限は、オーナーの1日の投稿数の上限（specs/024 FR-019）。省けば既定値
  const maxSlots = opts.maxSlots ?? AUTOPOST_SLOT_LIMIT;
  const minutes: number[] = [];
  for (const t of input.slotTimes) {
    const m = timeToMinutes(t);
    if (m === null) return { ok: false, reason: "invalid_time", times: [t] };
    minutes.push(m);
  }
  if (minutes.length > maxSlots) return { ok: false, reason: "too_many" };
  const seen = new Set<number>();
  for (const m of minutes) {
    if (seen.has(m)) return { ok: false, reason: "duplicate", times: [minutesToTime(m)] };
    seen.add(m);
  }
  if (input.enabled && minutes.length === 0) return { ok: false, reason: "required" };
  const sorted = [...minutes].sort((a, b) => a - b);
  if (input.jitter) {
    // 日付をまたいだ間（23:50 と 0:10）は数えない。ずらす幅はその日の中に収めるため、入れ替わらない
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]! - sorted[i - 1]! < AUTOPOST_MIN_GAP_MINUTES) {
        return { ok: false, reason: "too_close", times: [minutesToTime(sorted[i - 1]!), minutesToTime(sorted[i]!)] };
      }
    }
  }
  return { ok: true, slotMinutes: sorted };
}

/**
 * 日時の、日本時間の日付。
 * @param date - 日時
 * @returns "YYYY-MM-DD"
 */
export function jstDateOf(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 日本時間の日付の0時。
 * @param jstDate - "YYYY-MM-DD"
 * @returns その日の0時（日本時間）の日時
 */
export function jstMidnight(jstDate: string): Date {
  return new Date(Date.parse(`${jstDate}T00:00:00Z`) - JST_OFFSET_MS);
}

/**
 * 日付に日数を足す。
 * @param jstDate - "YYYY-MM-DD"
 * @param days - 足す日数（負でもよい）
 * @returns "YYYY-MM-DD"
 */
export function addDays(jstDate: string, days: number): string {
  return new Date(Date.parse(`${jstDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * FNV-1a（32bit）のハッシュ。
 * @param text - ハッシュする文字列
 * @returns 0〜2^32-1 の整数
 */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * その日のその時刻の、投稿の予定の時刻（FR-001a、research.md R2）。
 * ずらすときは、Account・日付・時刻のハッシュで前後10分の中の値を決める。同じ入力なら必ず同じ値になる。
 * ずらしても、その日の 0:00:00〜23:59:59 に収める。
 * @param accountId - accounts.id
 * @param jstDate - 日本時間の日付（"YYYY-MM-DD"）
 * @param slotMinute - 設定の時刻（0時からの分）
 * @param jitter - ずらすか
 * @returns 予定の時刻
 */
export function plannedSlotTime(accountId: string, jstDate: string, slotMinute: number, jitter: boolean): Date {
  const dayStart = jstMidnight(jstDate).getTime();
  const base = dayStart + slotMinute * 60_000;
  if (!jitter) return new Date(base);
  const offsetSec = (fnv1a(`${accountId}:${jstDate}:${slotMinute}`) % (AUTOPOST_JITTER_SECONDS * 2 + 1)) - AUTOPOST_JITTER_SECONDS;
  return new Date(Math.min(Math.max(base + offsetSec * 1000, dayStart), dayStart + DAY_MS - 1000));
}

/** 時刻の計算に使う、Accountの設定。 */
export type SlotSettings = {
  accountId: string;
  slotMinutes: number[];
  jitter: boolean;
  /** この時刻より後の予定だけを投稿する（FR-012・FR-016） */
  effectiveFrom: Date;
};

/** 来ている時刻。 */
export type DueSlot = { slotAt: Date; slotDate: string; slotMinute: number };

/**
 * 来ている時刻を求める（FR-011、contracts/auto-post-job.md 手順2）。
 * 予定を過ぎて60分以内で、effective_from より後の時刻のうち、もっとも新しい1つを返す（今日と昨日を見る）。
 * @param s - Accountの設定と今の時刻
 * @returns 来ている時刻。なければ null
 */
export function findDueSlot(s: SlotSettings & { now: Date }): DueSlot | null {
  const today = jstDateOf(s.now);
  const windowStart = s.now.getTime() - AUTOPOST_LATE_WINDOW_MINUTES * 60_000;
  let best: DueSlot | null = null;
  for (const date of [addDays(today, -1), today]) {
    for (const minute of s.slotMinutes) {
      const at = plannedSlotTime(s.accountId, date, minute, s.jitter);
      const t = at.getTime();
      if (t > s.now.getTime() || t <= windowStart || t <= s.effectiveFrom.getTime()) continue;
      if (!best || t > best.slotAt.getTime()) best = { slotAt: at, slotDate: date, slotMinute: minute };
    }
  }
  return best;
}

/** 予定の計算の入力（research.md R9）。 */
export type ProjectScheduleInput = SlotSettings & {
  enabled: boolean;
  /** Threadsの上限で止めたとき、再開する時刻 */
  pausedUntil: Date | null;
  now: Date;
  /** 今日・昨日に、すでに試みの行がある予定の時刻 */
  usedSlotTimes: Date[];
  /** 今日（日本時間）の投稿済みの件数 */
  publishedToday: number;
  /** 求める件数 */
  count: number;
};

/**
 * これから先の投稿の予定の時刻を、早い順に求める（FR-021・FR-022、research.md R9）。
 * 予定を過ぎて60分以内で、まだ試みの行がない時刻（これから処理される）は先頭に入れる。
 * 今日の分は「時刻の数 − 今日の投稿済み」件までにする（SC-008）。
 * @param input - 設定・今の時刻・使った時刻・今日の投稿済みの件数・件数
 * @returns 予定の時刻（最大 count 件）
 */
export function projectSchedule(input: ProjectScheduleInput): Date[] {
  if (!input.enabled || input.slotMinutes.length === 0 || input.count <= 0) return [];
  const result: Date[] = [];
  const used = new Set(input.usedSlotTimes.map((d) => d.getTime()));
  const today = jstDateOf(input.now);
  const pausedUntil = input.pausedUntil?.getTime() ?? null;
  const allowed = (at: Date) =>
    at.getTime() > input.effectiveFrom.getTime() && (pausedUntil === null || at.getTime() >= pausedUntil);
  let todayLeft = Math.max(0, input.slotMinutes.length - input.publishedToday);

  const due = findDueSlot(input);
  if (due && !used.has(due.slotAt.getTime()) && allowed(due.slotAt)) {
    const isToday = due.slotDate === today;
    if (!isToday || todayLeft > 0) {
      result.push(due.slotAt);
      if (isToday) todayLeft -= 1;
    }
  }

  // 止めている間の日数だけ先まで見る。過ぎた paused_until では足さない（負にすると先読みが縮み、時刻を返さなくなる）
  const pausedDays = pausedUntil ? Math.max(0, Math.ceil((pausedUntil - input.now.getTime()) / DAY_MS)) : 0;
  const maxDays = Math.ceil(input.count / input.slotMinutes.length) + 2 + pausedDays;
  for (let d = 0; d <= maxDays && result.length < input.count; d++) {
    const date = addDays(today, d);
    for (const minute of input.slotMinutes) {
      if (result.length >= input.count) break;
      const at = plannedSlotTime(input.accountId, date, minute, input.jitter);
      if (at.getTime() <= input.now.getTime() || !allowed(at)) continue;
      if (d === 0) {
        if (todayLeft <= 0) continue;
        todayLeft -= 1;
      }
      result.push(at);
    }
  }
  return result;
}

/**
 * 深夜の案内を出す時刻か（FR-001b）。設定は止めない。
 * @param minutes - 0時からの分
 * @returns 2:00〜4:59 なら true
 */
export function isLateNightSlot(minutes: number): boolean {
  return minutes >= LATE_NIGHT_HINT_MINUTES[0] && minutes < LATE_NIGHT_HINT_MINUTES[1];
}
