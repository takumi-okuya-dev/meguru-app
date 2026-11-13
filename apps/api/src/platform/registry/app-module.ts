// アプリの入口の形と、一覧を回す関数（specs/meguru/031-conflict-free-composition）。組み立ての一覧（app-modules.ts）は import と一覧だけにし、回すのはここ。
// アプリを足すときに共通の場所（app.ts・index.ts・jobs/daily-jobs.ts）を直さずに済むようにして、並行開発のぶつかりを減らす。
import type { AppId } from "@meguru/shared";
import type { Hono, MiddlewareHandler } from "hono";
import type { Env } from "../../kernel/env";
import type { AppEnv } from "../identity/auth";

/** 毎日の処理の1つ（名前と、走らせる関数）。 */
export type DailyJob = readonly [name: string, run: () => Promise<unknown>];

/** API のアプリの入口。各アプリの index.ts が1つ出す。 */
export type ApiAppModule = {
  /** アプリの番号（@meguru/shared の APP_CATALOG の id。道筋は /api/<id> の下につながる） */
  id: AppId;
  /** 共通への登録（機能・上限・利用の決まり・出来事の受け取り）。何度呼んでも1回だけ登録する */
  register: () => void;
  /** `/api/<id>` の下の道筋。ログインのミドルウェアを受け取る（Threads は道筋が多く、app.ts が自分でつなぐので持たない） */
  routes?: (authed: MiddlewareHandler<AppEnv>) => Hono<AppEnv>;
  /** 毎日の処理（利用の数の数え直しなど）。共通の料金の合わせ直しの前に、アプリの一覧の順に走る */
  dailyJobs?: (env: Env, now: Date) => readonly DailyJob[];
};

/**
 * アプリをすべて共通に登録する（app.ts・index.ts・毎日の処理の初めで呼ぶ。何度呼んでも1回だけ）。
 * @param apps - アプリの一覧（組み立ての app-modules.ts の API_APPS）
 */
export function registerAppModules(apps: readonly ApiAppModule[]): void {
  for (const m of apps) m.register();
}

/**
 * アプリの毎日の処理を、一覧の順に並べる。
 * @param apps - アプリの一覧
 * @param env - Workers のバインディング
 * @param now - 基準にする時刻
 * @returns 毎日の処理
 */
export function appDailyJobs(apps: readonly ApiAppModule[], env: Env, now: Date): DailyJob[] {
  return apps.flatMap((m) => m.dailyJobs?.(env, now) ?? []);
}
