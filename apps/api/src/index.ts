import { createApp } from "./app";
import type { Env } from "./env";
import { runAutoPost } from "./services/auto-post-runner";
import { runDailyJobs } from "./services/daily-jobs";

const app = createApp();

/** 自動投稿の Cron（specs/005-auto-post contracts/api.md「定期処理」）。それ以外は日次の処理。 */
const AUTO_POST_CRON = "*/5 * * * *";

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const at = new Date(controller.scheduledTime);
    ctx.waitUntil(
      controller.cron === AUTO_POST_CRON
        ? runAutoPost(env, at).then(() => undefined)
        : runDailyJobs(env, at),
    );
  },
} satisfies ExportedHandler<Env>;
