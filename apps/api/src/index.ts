import { createApp } from "./app";
import type { Env } from "./env";
import { runDailyJobs } from "./services/daily-jobs";

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyJobs(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
