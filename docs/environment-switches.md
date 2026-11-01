# 環境ごとのスイッチ

テスト版と本番で振る舞いを変えるときは、コードを分けずに、ここにあるスイッチ（環境の設定）で切り替えます（[architecture.md](architecture.md)「設計の意図」）。この表は、スイッチの一覧の正です。**スイッチを足したり値を変えたりしたら、同じ PR でこの表も直してください。**

## 一覧

| スイッチ | 何を切り替えるか | 手元 | テスト版 | 本番 | 置き場所 |
|---|---|---|---|---|---|
| `APP_ENV` | 環境の名前。ログの印と、設定の誤りを詳しく返すか（手元だけ） | `development` | `staging` | `production` | `wrangler.toml`・`.dev.vars` |
| `VITE_APP_ENV` | 画面の環境の帯（本番以外で「テスト版」などと出す）、検索に載せない指定 | `development` | `staging` | `production` | GitHub の Environment の変数・`apps/web/.env.local` |
| `BILLING_ENABLED` | 決済（無料体験・契約・料金の画面・読むだけ）。OFFなら全員がすべての機能を使える | `false` | `true` | `true` | `wrangler.toml`・`.dev.vars` |
| `TEST_GROUPS_ENABLED` | 招待制（テスト用のグループ・運営者の画面）。ONなら、招待リンクから入った人だけが使える | `false` | `true` | `false` | `wrangler.toml`・`.dev.vars` |
| `OPERATOR_CLERK_USER_IDS` | 運営者（Clerk のユーザーIDのカンマ区切り）。`TEST_GROUPS_ENABLED` がONのときだけ効く。運営者は運営者の画面を使え、料金なしで使える | 空 | 開発者 | 空 | Secret（`wrangler secret put`） |
| `THREADS_CONNECT_METHODS` | Threads につなぐ方法（`token`＝トークンを貼る、`app`＝Meta の画面で許可）。空なら両方 | 両方 | `token` | 両方 | `wrangler.toml`・`.dev.vars` |
| `THREADS_ACCESS_MODE` | Threads 連携の公開範囲の案内（`testers`＝Meta の審査前、`public`＝審査後） | `testers` | `testers` | `testers` | `wrangler.toml`・`.dev.vars` |

## 組み合わせたときの振る舞い

| 決済 | 招待制 | 誰が料金なしか | 画面 |
|---|---|---|---|
| OFF | — | 全員（決済がない） | 無料体験・料金の表示は出ない |
| ON | OFF（本番） | 料金なしの印を手で付けた人だけ | 登録から1か月は無料体験、そのあとは契約が要る |
| ON | ON（テスト版） | 料金なしの印の人と、運営者。グループに入った人には印が自動で付く | テストユーザーと運営者には、無料体験の表示が出ない。グループを通らずに前からいる人は、本番と同じく無料体験 |

## 変え方

- **`wrangler.toml` の値**：PR で `apps/api/wrangler.toml` の、その環境の `vars` を直します。マージすると、自動のデプロイで反映されます。
  - Cloudflare の管理画面で直接変えても、次のデプロイで `wrangler.toml` の値に戻ります。管理画面では変えないでください。
- **Secret**：`printf '%s' '値' | npx wrangler secret put 名前 --env staging`（本番は `--env production`）。すぐに反映され、デプロイは要りません。値は画面に出さず、パイプで渡します。
- **GitHub の Environment の変数**：Settings → Environments → その環境で変えます。画面に焼き込まれる値なので、変えたら Web を出し直します（develop か main に何かマージする）。
- **手元**：`apps/api/.dev.vars` と `apps/web/.env.local` を直し、開発用のサーバーを起動し直します。

`BILLING_ENABLED`・`TEST_GROUPS_ENABLED` は、`"true"`／`"false"` 以外の値や空にすると、API が設定の誤りとして止まります。打ち間違いで、黙って ON や OFF にならないようにするためです。

## 関係する文書

- 外部サービスの準備と、秘密の値の入れ方：[external-services-setup.md](external-services-setup.md)
- テスト版を作ったときの記録：[staging-setup-record.md](staging-setup-record.md)
- 決済：[specs/013-billing](../specs/013-billing/spec.md)
- テスト用のグループ：[specs/016-test-groups](../specs/016-test-groups/spec.md)
