// DBクライアント（research.md R8・R12）。
// 通常のクエリは HTTP 経由（neon-http）、対話的トランザクションは WebSocket 経由（neon-serverless の Pool）。
// Pool はリクエストごとに作って破棄する（Workers ではリクエストをまたいで接続を持てない）。
import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

const LOCAL_PROXY_HOST = "db.localtest.me";

let configuredForLocal = false;

/** ローカルの Postgres + local-neon-http-proxy に向けるときの設定（Neon 公式の手順） */
function configureLocalProxy(connectionString: string) {
  if (configuredForLocal) return;
  const host = new URL(connectionString).hostname;
  if (host !== LOCAL_PROXY_HOST) return;
  neonConfig.fetchEndpoint = (h) => (h === LOCAL_PROXY_HOST ? `http://${h}:4444/sql` : `https://${h}/sql`);
  neonConfig.useSecureWebSocket = false;
  neonConfig.wsProxy = (h) => (h === LOCAL_PROXY_HOST ? `${h}:4444/v2` : `${h}/v2`);
  neonConfig.pipelineConnect = false;
  configuredForLocal = true;
}

export function createDb(connectionString: string) {
  configureLocalProxy(connectionString);
  return drizzleHttp({ client: neon(connectionString), schema });
}

export type Db = ReturnType<typeof createDb>;

/**
 * 対話的トランザクションを1回だけ実行する。Pool はこの呼び出しの中で作って閉じる。
 * callback の Account 作成（research.md R8）、データ削除の試行（R7）、Account削除（R13）で使う。
 */
export async function withTransaction<T>(
  connectionString: string,
  fn: (tx: TxDb) => Promise<T>,
): Promise<T> {
  configureLocalProxy(connectionString);
  const pool = new Pool({ connectionString });
  // 終了後に WebSocket が閉じたときのエラーを、未処理のまま投げさせない
  pool.on("error", () => {});
  try {
    const db = drizzleWs({ client: pool, schema });
    return await db.transaction(fn);
  } finally {
    await pool.end();
  }
}

type WsDb = ReturnType<typeof drizzleWs<typeof schema>>;
export type TxDb = Parameters<Parameters<WsDb["transaction"]>[0]>[0];
