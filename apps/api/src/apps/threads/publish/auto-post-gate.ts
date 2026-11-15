// 定期処理の関所（specs/005-auto-post research.md R3、contracts/auto-post-job.md 手順0・7）。
// 5分ごとの処理は、まずKVを見て、用がなければDBに触れずに終える（Neonを止める時間を作り、無料枠に収めるため）。
// autopost:gate は定期処理だけが、autopost:wake はAPIだけが書く（書く側を1つに決め、同時に書いても値を失わない）。
import { AUTOPOST_GATE_MAX_SLEEP_MINUTES } from "@meguru/shared";

const GATE_KEY = "autopost:gate";
const WAKE_KEY = "autopost:wake";
/** その日の反応数の補いを終えた日（日本時間。specs/006 contracts/metrics-job.md）。定期処理だけが書く。 */
const CATCHUP_KEY = "metrics:catchup";

/** 関所の値。 */
export type GateValue = { nextCheckAt: string; runStartedAt: string };

/** 関所の状態。readable が false なら、KVが読めない・値が壊れている（安全側でDBの処理をする）。 */
export type GateState = {
  readable: boolean;
  gate: GateValue | null;
  wakeAt: string | null;
  /** その日の反応数の補いを終えた日（YYYY-MM-DD）。読めなければ null（補いをもう一度するだけで害はない） */
  catchupDate: string | null;
};

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/**
 * 関所を読む。
 * @param kv - AUTOPOST_KV
 * @returns 関所の状態
 */
export async function readGate(kv: KVNamespace): Promise<GateState> {
  try {
    const [gateRaw, wakeRaw, catchupRaw] = await Promise.all([kv.get(GATE_KEY), kv.get(WAKE_KEY), kv.get(CATCHUP_KEY)]);
    const catchupDate = catchupRaw !== null && /^\d{4}-\d{2}-\d{2}$/.test(catchupRaw) ? catchupRaw : null;
    const gate = gateRaw === null ? null : (JSON.parse(gateRaw) as Partial<GateValue>);
    const wake = wakeRaw === null ? null : (JSON.parse(wakeRaw) as { at?: unknown });
    if (gate && (!isIso(gate.nextCheckAt) || !isIso(gate.runStartedAt)))
      return { readable: false, gate: null, wakeAt: null, catchupDate: null };
    if (wake && !isIso(wake.at)) return { readable: false, gate: null, wakeAt: null, catchupDate: null };
    return {
      readable: true,
      gate: gate as GateValue | null,
      wakeAt: (wake?.at as string | undefined) ?? null,
      catchupDate,
    };
  } catch {
    return { readable: false, gate: null, wakeAt: null, catchupDate: null };
  }
}

/**
 * DBの処理をするか。次に見る時刻を過ぎた・設定の変更の知らせが前回の処理より後・関所がない・読めない、のどれか。
 * @param state - 関所の状態
 * @param now - 今の時刻
 * @returns DBの処理をするなら true
 */
export function shouldRun(state: GateState, now: Date): boolean {
  if (!state.readable || !state.gate) return true;
  if (now.getTime() >= Date.parse(state.gate.nextCheckAt)) return true;
  return state.wakeAt !== null && Date.parse(state.wakeAt) > Date.parse(state.gate.runStartedAt);
}

/**
 * 関所を書く。失敗しても前の値（過ぎた時刻）が残り、次の回もDBの処理が動くので、ログに出すだけでよい。
 * @param kv - AUTOPOST_KV
 * @param value - 次に見る時刻と、この回の開始時刻
 * @returns 書けたら true
 */
export async function writeGate(kv: KVNamespace, value: GateValue): Promise<boolean> {
  try {
    await kv.put(GATE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * 次に見る時刻を求める（research.md R3）。候補のうちもっとも早い時刻。すぐ続ける処理があれば今。上限は24時間後。
 * 一定の間隔での見直しは入れない（予定の時刻に起きたついでに、全員の設定を読み直すため）。
 * @param input - now：今、candidates：予定の時刻・やり直しの時刻、immediate：次の回にも続きがあるか
 * @returns 次に見る時刻
 */
export function computeNextCheckAt(input: {
  now: Date;
  candidates: Date[];
  immediate: boolean;
}): Date {
  if (input.immediate) return input.now;
  let next = input.now.getTime() + AUTOPOST_GATE_MAX_SLEEP_MINUTES * 60_000;
  for (const c of input.candidates) next = Math.min(next, c.getTime());
  return new Date(Math.max(next, input.now.getTime()));
}

/**
 * その日の反応数の補いを終えた日を書く（specs/006 contracts/metrics-job.md 6-6）。失敗しても、補いをもう一度するだけ。
 * @param kv - AUTOPOST_KV
 * @param jstDate - 日本時間の日付（YYYY-MM-DD）
 * @returns 書けたら true
 */
export async function writeCatchupDate(kv: KVNamespace, jstDate: string): Promise<boolean> {
  try {
    await kv.put(CATCHUP_KEY, jstDate);
    return true;
  } catch {
    return false;
  }
}
