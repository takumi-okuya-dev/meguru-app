// 暗号鍵のローテーション（research.md R5）。
// 使い方: TOKEN_ENCRYPTION_KEYS='{"1":"…","2":"…"}' TOKEN_ENCRYPTION_KEY_VERSION=2 DATABASE_URL=… pnpm --filter api admin:rotate-token-key
// 最後に旧バージョンの行の件数を表示する。0件になったら、古い鍵を鍵リングから外してよい。
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import type { Env } from "../src/kernel/env";
import { rotateTokenKeys } from "../src/jobs/key-rotation";

neonConfig.webSocketConstructor = ws;

const required = ["TOKEN_ENCRYPTION_KEYS", "TOKEN_ENCRYPTION_KEY_VERSION", "DATABASE_URL"] as const;
for (const name of required) {
  if (!process.env[name]) {
    console.error(`${name} を設定してください`);
    process.exit(1);
  }
}

const result = await rotateTokenKeys(process.env as unknown as Env);
console.log(
  `暗号化し直した行: ${result.rotated} / 再接続などで飛ばした行: ${result.skipped} / 旧バージョンの残り: ${result.remainingOldVersionRows}`,
);
if (result.remainingOldVersionRows > 0) {
  console.log("旧バージョンの行が残っています。もう一度実行してから、古い鍵を外してください。");
  process.exitCode = 1;
}
