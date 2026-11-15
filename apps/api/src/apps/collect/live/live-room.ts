// 会場の共有の Durable Object（specs/collect/001-event-day-collection research.md R4、contracts/realtime.md 5、tasks.md T038）。
// イベントごとに1つ（名前＝イベントの番号）。つないでいる画面を持ち、API から受けた知らせを全員に配るだけで、何も保存しない。
// WebSocket の休止の仕組み（ctx.acceptWebSocket）を使うので、つないでいる間も時間で課金されない。
// この Durable Object へは、Worker の中（結びつけ COLLECT_LIVE）からしか届かない。つなぐ道筋は live-routes.ts が
// 入場券を確かめてから /connect だけに渡す。
// cloudflare:workers の DurableObject を継がない形（ctx を受け取るだけの class）にする。APIの入口の一覧を書き出すスクリプトと
// そのテストが Node で app.ts を読むため（Node は cloudflare: の import を読めない）。WebSocket の休止の仕組みはこの形でも使える。

/** Worker から渡す、受付をする人の見出し。 */
export const LIVE_RECEIVER_HEADER = "X-Collect-Receiver";

/** 手伝う人の画面に付ける印（リンクを止めたとき、手伝う人の画面だけを閉じる）。 */
const HELPER_TAG = "helper";

/** リンクを止めたときに手伝う人の画面を閉じる理由の番号（4000番台はアプリが決めてよい）。 */
export const LINK_STOPPED_CLOSE_CODE = 4001;

/** 会場の共有の Durable Object。 */
export class CollectLiveRoom {
  /**
   * Durable Object を作る（イベントごとに1つ）。
   * @param ctx - Durable Object の状態（WebSocket の受け入れに使う。保存は使わない）
   */
  constructor(private readonly ctx: DurableObjectState) {}

  /**
   * Worker からの呼び出し：/connect（画面をつなぐ）と /broadcast（知らせを配る）。
   * @param request - Worker が作った呼び出し
   * @returns 応答
   */
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/connect") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
      const receiver = request.headers.get(LIVE_RECEIVER_HEADER);
      if (!receiver) return new Response("receiver required", { status: 400 });
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server, receiver === "owner" ? ["owner"] : [HELPER_TAG]);
      server.serializeAttachment({ receiver });
      return new Response(null, { status: 101, webSocket: client });
    }
    if (path === "/broadcast" && request.method === "POST") {
      const text = await request.text();
      const { type } = JSON.parse(text) as { type?: string };
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(text);
        } catch {
          // 閉じかけの画面には送れない（つなぎ直したらスナップショットを読み直す）
        }
      }
      if (type === "link.stopped") {
        for (const ws of this.ctx.getWebSockets(HELPER_TAG)) {
          try {
            ws.close(LINK_STOPPED_CLOSE_CODE, "link stopped");
          } catch {
            // すでに閉じている
          }
        }
      }
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }

  /** 画面からは何も送らない（記録はいつも API で行う。contracts/realtime.md 3）。 */
  async webSocketMessage(): Promise<void> {}

  /**
   * 画面が閉じたら、こちらも閉じる。
   * @param ws - 閉じた画面
   * @param code - 閉じた理由の番号
   * @param reason - 閉じた理由
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // すでに閉じている
    }
  }
}
