// 知らせ（共通 → アプリ）の仕組み（specs/027-modular-monolith research.md R4、contracts/module-boundaries.md 3）。
// 共通はアプリを直接使えないので、共通の処理の途中でアプリの処理が要るときは、共通が知らせを出し、アプリが受け取る。
// 受け取る関数は、組み立て（app.ts・index.ts）でアプリの registerXxx() を1回呼んで登録する。
// 呼ぶ側は今の呼び出しと同じ場所・同じ順番・同じトランザクションで await する（動きを変えない）。
import type { TxDb } from "../kernel/db/client";
import type { Env } from "../kernel/env";

/** 知らせの名前と、受け取る値（docs/module-map.md 1-4）。 */
export type HookPayloads = {
  /** アカウントを消す前（同じトランザクションの中）。 */
  accountDeleting: { tx: TxDb; accountId: string };
  /** 退会で、持っているアカウントを消す前（同じトランザクションの中）。 */
  userWithdrawing: { tx: TxDb; userId: string };
  /** 退会で、持っているアカウントを消したあと（同じトランザクションの中）。threadsUserIds は消したアカウントのThreadsのユーザーID、now は退会の処理の時刻。 */
  userAccountsDeleted: { tx: TxDb; userId: string; threadsUserIds: string[]; now: Date };
  /** 上限（全員の既定値・人ごと）を保存したあと。 */
  limitsChanged: { env: Pick<Env, "AUTOPOST_KV"> };
  /** アカウントを開いた（最後に開いたアカウントを記録した）あと、応答を返す前。 */
  accountOpened: { env: Env; accountId: string };
};

/** 知らせの名前。 */
export type HookName = keyof HookPayloads;

/** 受け取る関数。 */
export type HookHandler<K extends HookName> = (payload: HookPayloads[K]) => Promise<void> | void;

const handlers: { [K in HookName]?: HookHandler<K>[] } = {};

/**
 * 知らせを受け取る関数を登録する（組み立てから、アプリの registerXxx() の中で呼ぶ）。
 * @param name - 知らせの名前
 * @param handler - 受け取る関数
 */
export function registerHook<K extends HookName>(name: K, handler: HookHandler<K>): void {
  const list = (handlers[name] ??= []) as HookHandler<K>[];
  list.push(handler);
}

/**
 * 知らせを出す。登録した順に1つずつ await し、例外はそのまま返す（あとの受け取りは呼ばない）。登録がなければ何もしない。
 * @param name - 知らせの名前
 * @param payload - 受け取る値
 */
export async function runHook<K extends HookName>(name: K, payload: HookPayloads[K]): Promise<void> {
  for (const handler of (handlers[name] ?? []) as HookHandler<K>[]) await handler(payload);
}

/** 登録をすべて消す（テスト用）。 */
export function resetHooks(): void {
  for (const key of Object.keys(handlers) as HookName[]) delete handlers[key];
}
