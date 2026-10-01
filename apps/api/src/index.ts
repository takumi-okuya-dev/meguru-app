import { createApp } from "./app";
import type { Env } from "./env";

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    // 日次の定期処理（T084で実装）
  },
} satisfies ExportedHandler<Env>;
