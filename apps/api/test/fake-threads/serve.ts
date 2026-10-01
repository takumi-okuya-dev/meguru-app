// E2E・ローカル確認用に偽のThreadsサーバーを起動する（既定のポートは 8790）
import { serve } from "@hono/node-server";
import { createFakeThreads } from "./server";

const port = Number(process.env.FAKE_THREADS_PORT ?? 8790);
const app = createFakeThreads();
serve({ fetch: app.fetch, port });
// E2E用に既定のユーザーを1人登録しておく
await app.request("/__control/users", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "9001", username: "e2e_user", name: "E2E User" }),
});
console.log(`fake threads listening on http://localhost:${port}`);
