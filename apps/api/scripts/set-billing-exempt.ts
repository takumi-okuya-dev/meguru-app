// 料金なしの印を付け・外す（specs/013-billing FR-062、research.md R11）。開発者・テストユーザー用。画面は作らない。
// 使い方: DATABASE_URL=… pnpm --filter api admin:set-billing-exempt <email> on|off [--force]
// 付けるときに終わっていない契約があれば、重ねて請求しないよう止める（--force で付ける。契約は支払いの画面で解約してもらう）。
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { createDb } from "../src/kernel/db/client";
import { setBillingExemptByEmail } from "../src/platform/billing/billing-service";

neonConfig.webSocketConstructor = ws;

const [email, mode, ...rest] = process.argv.slice(2);
if (!email || (mode !== "on" && mode !== "off") || !process.env.DATABASE_URL) {
  console.error("使い方: DATABASE_URL=… pnpm --filter api admin:set-billing-exempt <email> on|off [--force]");
  process.exit(1);
}

const result = await setBillingExemptByEmail(createDb(process.env.DATABASE_URL), email, mode === "on", rest.includes("--force"));
if (result.kind === "not_found") {
  console.error(`${email} の利用者は見つかりません`);
  process.exitCode = 1;
} else if (result.kind === "ambiguous") {
  // 同じアドレスの行が2つ以上あると、どちらに書いたか後から区別できない。
  // 何も書かずに止めて、id を出す（セキュリティ監査 run-1）
  console.error(`${email} の利用者が${result.count}人います。何も変えていません。`);
  for (const u of result.users) console.error(`  - ${u.id}（Clerk: ${u.clerkUserId}）`);
  console.error("どの利用者かをClerkの画面で確かめ、DBで id を指定して直してください。");
  process.exitCode = 1;
} else if (result.kind === "has_subscription") {
  console.error(`契約（${result.status}）があります。重ねて請求しないよう、支払いの画面で解約してもらってから付けるか、--force を付けてください`);
  process.exitCode = 1;
} else {
  // どの行を変えたかを出す（同じアドレスが将来重なったときに、記録として残るように）
  console.log(`${result.email}（${result.id}）：料金なし ${result.before ? "あり" : "なし"} → ${result.after ? "あり" : "なし"}`);
}
