// アプリの一覧（組み立て。specs/meguru/031-conflict-free-composition）。
// アプリを足すときは、ここに import を1行と、一覧に1行を足すだけにする（app.ts・index.ts・jobs/daily-jobs.ts は直さない）。
// このファイルは .gitattributes で merge=union にしてある：2つのブランチが同時に1行ずつ足しても、両方の行が残る。
// そのため、1行に1つだけ書き、ほかの中身を足さない（docs/parallel-development.md 11）。
import type { ApiAppModule, DailyJob } from "./platform";
import type { Env } from "./kernel/env";
import { threadsModule } from "./apps/threads";
import { collectModule } from "./apps/collect";
import { peopleModule } from "./apps/people";

/** API のアプリの一覧（登録・道筋・毎日の処理の順）。 */
// prettier-ignore
export const API_APPS: readonly ApiAppModule[] = [
  threadsModule,
  collectModule,
  peopleModule,
];

/** すべてのアプリを共通に登録する（app.ts・index.ts・毎日の処理の初めで呼ぶ。何度呼んでも1回だけ）。 */
export function registerApps(): void {
  for (const m of API_APPS) m.register();
}

/**
 * アプリの毎日の処理（一覧の順）。
 * @param env - Workers のバインディング
 * @param now - 基準にする時刻
 * @returns 毎日の処理
 */
export function appDailyJobs(env: Env, now: Date): DailyJob[] {
  return API_APPS.flatMap((m) => m.dailyJobs?.(env, now) ?? []);
}
