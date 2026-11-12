import { createApp } from "./app";
import type { Env } from "./kernel/env";
import { runAutoPost, registerThreads } from "./apps/threads";
import { deliverPendingEvents } from "./platform";
import { validateConfig } from "./kernel/config";
import { logger, setLogAppEnv } from "./kernel/logger";
import { runDailyJobs } from "./jobs/daily-jobs";

const app = createApp();

/** 自動投稿の Cron（specs/005-auto-post contracts/api.md「定期処理」）。それ以外は日次の処理。 */
const AUTO_POST_CRON = "*/5 * * * *";

/**
 * 5分ごとの最初に、届いていない出来事を届ける（specs/meguru/029 research.md R5）。失敗しても自動投稿は止めない。
 * @param env - Workers のバインディング
 * @param at - 回の開始時刻
 */
async function deliverEvents(env: Env, at: Date): Promise<void> {
  try {
    const result = await deliverPendingEvents(env, at);
    if (result.delivered > 0 || result.failed > 0) logger.info("platform events delivered", result);
  } catch (err) {
    logger.error("platform events: delivery run failed", { err });
  }
}

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // アプリの登録（機能・上限・出来事の受け取り）をする（何度呼んでも1回だけ。specs/meguru/029）
    registerThreads();
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
