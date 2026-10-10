// E2E・ローカル確認用に偽のThreadsサーバーを起動する（既定のポートは 8790）
import { serve } from "@hono/node-server";
import { createFakeThreads } from "./server";

const port = Number(process.env.FAKE_THREADS_PORT ?? 8790);
const app = createFakeThreads();
serve({ fetch: app.fetch, port });
// E2E・ローカル確認用のユーザーを登録しておく。最初の1人が「許可する」の既定。
// 2人目・3人目は、チーム運用の確認（オーナーを複数・パートナーの自社）に使う。認可画面で選べる
for (const user of [
  { id: "9001", username: "e2e_user", name: "E2E User" },
  { id: "9002", username: "partner_co", name: "Partner Co" },
  { id: "9003", username: "cafe_b", name: "Cafe B" },
]) {
  await app.request("/__control/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
}
console.log(`fake threads listening on http://localhost:${port}`);
