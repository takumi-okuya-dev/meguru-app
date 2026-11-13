import { createApp } from "./app";
import type { Env } from "./kernel/env";
import { runAutoPost } from "./apps/threads";
import { API_APPS } from "./app-modules";
import { createDb } from "./kernel/db/client";
import { deliverPendingEvents, nextEventCheckAt, nextPendingAttemptAt, readEventGate, registerAppModules, shouldDeliver, writeEventGate } from "./platform";
import { validateConfig } from "./kernel/config";
import { logger, setLogAppEnv } from "./kernel/logger";
import { runDailyJobs } from "./jobs/daily-jobs";

// アプリの Durable Object（一覧は durable-objects.ts。wrangler.toml の結びつけと同じ名前で書き出す）
export * from "./durable-objects";

const app = createApp();

/** 自動投稿の Cron（specs/005-auto-post contracts/api.md「定期処理」）。それ以外は日次の処理。 */
const AUTO_POST_CRON = "*/5 * * * *";

/**
 * 5分ごとの最初に、届いていない出来事を届ける（specs/meguru/029 research.md R5）。失敗しても自動投稿は止めない。
 * 用のない回はDBを起こさない（KVの関所。platform/events/delivery-gate.ts）。関所を書くのはここだけ。
 * @param env - Workers のバインディング
 * @param at - 回の開始時刻
 */
async function deliverEvents(env: Env, at: Date): Promise<void> {
  try {
    if (!shouldDeliver(await readEventGate(env.AUTOPOST_KV), at)) return;
    const result = await deliverPendingEvents(env, at);
    if (result.delivered > 0 || result.failed > 0) logger.info("platform events delivered", result);
    // 届けが終わったあとの、いちばん早い次に試す時刻まで眠る（届けが失敗で止まったら関所を書かず、次の回もDBを見る）
    const next = await nextPendingAttemptAt(createDb(env.DATABASE_URL));
    await writeEventGate(env.AUTOPOST_KV, { nextCheckAt: nextEventCheckAt(at, next).toISOString(), runStartedAt: at.toISOString() });
  } catch (err) {
    logger.error("platform events: delivery run failed", { err });
  }
}

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // アプリの登録（機能・上限・出来事の受け取り）をする（何度呼んでも1回だけ。specs/meguru/029）
    registerAppModules(API_APPS);
    setLogAppEnv(env.APP_ENV);
    // 設定の関所は fetch 側のミドルウェアにしか無かったので、Cron はここで同じ検査をする。
    // 置き石や取り違えた鍵のまま、実際のThreadsアカウントへ投稿しないため（FR-063、
    // セキュリティ監査 run-1）。KVの関所にも触らずに戻る（次に見る時刻を進めない）
    const problems = validateConfig(env);
    if (problems.length > 0) {
      logger.error("server configuration error: refusing to run scheduled jobs", { variables: problems });
      return;
    }
    // 判断（60分の幅・持ち時間・やり直し）には実際の開始時刻を使う。回の開始が遅れても、予定時刻で判断しない
    const at = new Date();
    ctx.waitUntil(
      controller.cron === AUTO_POST_CRON
        ? // 出来事の届けで自動投稿を待たせない（同時に動かす。片方の失敗でもう片方を止めない）
          Promise.allSettled([deliverEvents(env, at), runAutoPost(env, at)]).then(() => undefined)
        : runDailyJobs(env, at),
    );
  },
} satisfies ExportedHandler<Env>;
