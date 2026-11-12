// E2E・ローカル確認用に偽のStripeを起動する（既定のポートは 8791。specs/013-billing quickstart.md）
// Webhookの送り先と秘密は FAKE_STRIPE_WEBHOOK_URL・FAKE_STRIPE_WEBHOOK_SECRET（どちらもあれば、Checkoutの完了などで送る）
import { serve } from "@hono/node-server";
import { loadWorktreeEnv } from "../../scripts/worktree-env";
import { createFakeStripe } from "./server";

// 作業場所を分けているときは、ずらし幅を足す（scripts/worktree-env.ts）
const port = Number(process.env.FAKE_STRIPE_PORT ?? 8791 + loadWorktreeEnv().portOffset);
const app = createFakeStripe();
serve({ fetch: app.fetch, port });
const url = process.env.FAKE_STRIPE_WEBHOOK_URL;
const secret = process.env.FAKE_STRIPE_WEBHOOK_SECRET;
if (url && secret) {
  await app.request("/__control/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret }),
  });
}
console.log(`fake stripe listening on http://localhost:${port}`);
