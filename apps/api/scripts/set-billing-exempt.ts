// 料金なしの印を付け・外す（specs/013-billing FR-062、research.md R11）。開発者・テストユーザー用。画面は作らない。
// 使い方: DATABASE_URL=… pnpm --filter api admin:set-billing-exempt <email> on|off [--force]
// 付けるときに終わっていない契約があれば、重ねて請求しないよう止める（--force で付ける。契約は支払いの画面で解約してもらう）。
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { createDb } from "../src/db/client";
import { setBillingExemptByEmail } from "../src/services/billing-service";

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
} else if (result.kind === "has_subscription") {
  console.error(`契約（${result.status}）があります。重ねて請求しないよう、支払いの画面で解約してもらってから付けるか、--force を付けてください`);
  process.exitCode = 1;
} else {
  console.log(`${result.email}：料金なし ${result.before ? "あり" : "なし"} → ${result.after ? "あり" : "なし"}`);
}
