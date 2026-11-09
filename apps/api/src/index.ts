import { createApp } from "./app";
import type { Env } from "./kernel/env";
import { runAutoPost } from "./services/auto-post-runner";
import { validateConfig } from "./kernel/config";
import { logger, setLogAppEnv } from "./kernel/logger";
import { runDailyJobs } from "./services/daily-jobs";
import { registerThreads } from "./services/threads-hooks";

const app = createApp();

/** 自動投稿の Cron（specs/005-auto-post contracts/api.md「定期処理」）。それ以外は日次の処理。 */
const AUTO_POST_CRON = "*/5 * * * *";

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // アプリの知らせの受け取りを登録する（specs/027。何度呼んでも1回だけ）
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
        ? runAutoPost(env, at).then(() => undefined)
        : runDailyJobs(env, at),
    );
  },
} satisfies ExportedHandler<Env>;
