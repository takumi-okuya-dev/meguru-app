# 会場の共有の取り決め（WebSocket）

**対象**：spec FR-038・SC-006 | **決めた理由**：[research.md](../research.md) R4・R5

## 1. つなぎ方

1. 画面が入場券を受け取る。
   - 主催者：`POST /api/collect/events/:eventId/live-ticket`（ログイン）
   - 手伝う人：`POST /api/collect/r/:token/live-ticket`（`X-Collect-Device`）
   - 応答：`{ ticket, expiresAt }`。入場券は、イベントの番号・受付をする人（`owner`か手伝う人の番号）・60秒の期限に、`COLLECT_LIVE_SECRET`で署名したもの。
2. 画面が`GET /api/collect/live?ticket=…`（`Upgrade: websocket`）につなぐ。Workerは署名と期限を確かめ、そのイベントのDurable Object（`CollectLiveRoom`、名前＝イベントの番号）に渡す。合わなければ401。
3. つないだら、画面はスナップショット（`GET …/reception`）を読み、`version`を覚える。

## 2. 届く知らせ（サーバー → 画面）

どの知らせも`{ type, eventId, version, at }`を持つ。

| type | 中身 | 画面がすること |
|---|---|---|
| `reception.recorded` | `{ personId, record }` | その行を受付済みにし、上の数字を足す |
| `reception.undone` | `{ personId }` | その行を未受付に戻す |
| `roster.changed` | `{ personId?, person? }`（飛び入り・名簿の変更） | 行を足す・直す。中身がなければスナップショットを読み直す |
| `helpers.changed` | `{ helpers }` | 受付をしている人の表示を直す |
| `link.stopped` | なし | 手伝う人の画面は「このリンクは止められました」にする |
| `resync` | なし | スナップショットを読み直す |

- 画面は、届いた`version`が「覚えている`version`＋1」でなければ、スナップショットを読み直す（知らせの抜けを埋める）。
- 主催者の画面にだけ届く中身はない（手伝う人に見せない列は、知らせにも入れない。メモは送らない）。

## 3. 画面から送るもの（画面 → サーバー）

- 送らない（記録はいつもAPIで行う）。生きているかの確かめは、WebSocketのping（課金されない）に任せる。

## 4. 途切れたとき

| 場面 | すること |
|---|---|
| つながりが切れた | 1秒・2秒・4秒…（最大30秒）で入場券を取り直してつなぎ直す。つながったらスナップショットを読み直す |
| つながらない | つながらない間は、15秒ごとにスナップショットを読み直す |
| 画面に戻った（タブ・アプリの切り替え） | スナップショットを読み直す |
| リンクが止められた（手伝う人） | つなぎ直さない |

## 5. Durable Objectの役目

- `CollectLiveRoom`は、つないでいる画面を持ち、APIから`POST /broadcast`（Workerの中からだけ呼べる）で受けた知らせを全員に配るだけ。何も保存しない（`new_sqlite_classes`で作るが、保存は使わない）。
- WebSocketの休止の仕組み（`ctx.acceptWebSocket`）を使う。手伝う人の画面には、受け取った人の番号を`serializeAttachment`で持たせ、`link.stopped`のときに手伝う人の画面だけ閉じる。
- `wrangler.toml`の一番上・`env.staging`・`env.production`のすべてに、Durable Objectの結びつけ（`COLLECT_LIVE`）とマイグレーションを書く（今の`test/unit/wrangler-config.test.ts`が書き忘れを止める形にそろえる）。
