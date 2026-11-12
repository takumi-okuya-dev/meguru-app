// 出来事の届けの関所（費用のため。docs/architecture.md「定期処理は用がないときDBを起こさない」）。
// 5分ごとの届けは、まずKVを見て、用がなければDBに触れずに終える。自動投稿の関所（apps/threads/publish/auto-post-gate.ts）と同じ形：
// platform-events:gate は5分ごとの届けだけが書き、platform-events:wake は書いた直後の届け（deliverPendingEvents に eventIds を渡した回）だけが書く。
// 書く側を分けるので、同時に書いても新しい値を古い値で上書きしない（PR #109 のセルフレビュー）。
import { logger } from "../../kernel/logger";

const GATE_KEY = "platform-events:gate";
const WAKE_KEY = "platform-events:wake";
/** 何もなければ、この時間ごとに念のためDBを見る（自動投稿の関所の上限と同じ24時間） */
const MAX_SLEEP_MS = 24 * 60 * 60_000;

/** 関所の値。 */
export type EventGate = { nextCheckAt: string; runStartedAt: string };

/** 関所の状態。readable が false なら、KVが読めない・値が壊れている（安全側でDBを見る）。 */
export type EventGateState = { readable: boolean; gate: EventGate | null; wakeAt: string | null };

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/**
 * JSONを読む（読めなければ null）。
 * @param raw - 文字列
 * @returns 値
 */
function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * 関所を読む。
 * @param kv - AUTOPOST_KV
 * @returns 関所の状態
 */
export async function readEventGate(kv: KVNamespace): Promise<EventGateState> {
  try {
    const [gateRaw, wakeRaw] = await Promise.all([kv.get(GATE_KEY), kv.get(WAKE_KEY)]);
    const gate = gateRaw === null ? null : (JSON.parse(gateRaw) as Partial<EventGate>);
    const wake = wakeRaw === null ? null : parseJson<{ at?: unknown }>(wakeRaw);
    if (gate && (!isIso(gate.nextCheckAt) || !isIso(gate.runStartedAt))) return { readable: false, gate: null, wakeAt: null };
    // 壊れた知らせは、ないものとして扱う（5分ごとの届けは知らせを書き直さないので、読めない扱いにすると毎回DBを見続ける）
    return { readable: true, gate: gate as EventGate | null, wakeAt: wake && isIso(wake.at) ? wake.at : null };
  } catch {
    return { readable: false, gate: null, wakeAt: null };
  }
}

/**
 * DBを見て届けるか。関所がない・読めない・次に見る時刻を過ぎた・起こす知らせが前回の開始時刻より後、のどれか。
 * @param state - 関所の状態
 * @param now - 今の時刻
 * @returns 届けるなら true
 */
export function shouldDeliver(state: EventGateState, now: Date): boolean {
  if (!state.readable || !state.gate) return true;
  if (now.getTime() >= Date.parse(state.gate.nextCheckAt)) return true;
  return state.wakeAt !== null && Date.parse(state.wakeAt) > Date.parse(state.gate.runStartedAt);
}

/**
 * 次に見る時刻を求める：まだ届いていない届けの、いちばん早い「次に試す時刻」。なければ24時間後。過去なら今。
 * @param now - 今の時刻
 * @param nextAttemptAt - いちばん早い次に試す時刻（なければ null）
 * @returns 次に見る時刻
 */
export function nextEventCheckAt(now: Date, nextAttemptAt: Date | null): Date {
  const cap = now.getTime() + MAX_SLEEP_MS;
  if (!nextAttemptAt) return new Date(cap);
  return new Date(Math.max(now.getTime(), Math.min(cap, nextAttemptAt.getTime())));
}

/**
 * 関所を書く（5分ごとの届けだけが呼ぶ）。失敗しても前の値（過ぎた時刻）が残り、次の回もDBを見るので、ログに出すだけでよい。
 * @param kv - AUTOPOST_KV
 * @param value - 次に見る時刻と、この回の開始時刻
 */
export async function writeEventGate(kv: KVNamespace, value: EventGate): Promise<void> {
  try {
    await kv.put(GATE_KEY, JSON.stringify(value));
  } catch (err) {
    logger.warn("platform events: failed to write gate", { err: String(err) });
  }
}

/**
 * 5分ごとの届けを起こす（書いた直後の届けで届け残しがあったときに、deliverPendingEvents が呼ぶ。5分ごとの届けは書かない）。
 * 書けなくても止めない（届け残しは、関所の24時間ごとの見直しで拾う）。
 * @param kv - AUTOPOST_KV
 * @param now - 今の時刻
 */
export async function wakeEventDelivery(kv: KVNamespace, now: Date = new Date()): Promise<void> {
  try {
    await kv.put(WAKE_KEY, JSON.stringify({ at: now.toISOString() }));
  } catch (err) {
    logger.warn("platform events: failed to write wake", { err: String(err) });
  }
}
