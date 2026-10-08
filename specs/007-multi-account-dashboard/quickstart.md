# 動作確認ガイド：マルチアカウントの要確認件数

**対象**：[spec.md](./spec.md) ／ **契約**：[API](./contracts/api.md)・[切り替えメニュー](./contracts/ui-menu.md)

007が端から端まで動くことを確かめる手順。テストの実装内容は、次の工程で作る `tasks.md` で決める。

## 前提と起動

- [README.md](../../README.md)に従って、Node.js、pnpm、Docker、Clerkの開発用設定を済ませる。
- 既存の001〜006のマイグレーションが適用済み。007の新しいマイグレーションはない。
- 偽のThreadsでの確認には次を使う。

```bash
pnpm install
docker compose up -d
pnpm --filter api db:migrate
pnpm dev:fake
```

ログイン済みの画面は `http://localhost:5173`。偽のThreadsの制御口は `http://localhost:8790`。

## 自動テストで確かめること

```bash
pnpm --filter api test -- needs-review-counts
pnpm --filter web test -- account-switcher
pnpm typecheck
pnpm lint
```

実装時に追加するAPI・Webのテストには、次を含める。

| 場面 | 期待 | 根拠 |
|---|---|---|
| 所有Account 3件に要確認5件・2件・0件 | 集計の応答が3件をすべて含み、投稿ストックの件数と一致 | FR-002・003、SC-002 |
| 他人のAccountに要確認がある | 応答にそのAccountも件数も含まない | FR-009、SC-003 |
| 所有Accountが0件、または接続が要再接続 | 前者は空配列、後者は保有Accountとして件数を返す | FR-003・005 |
| 一覧にあるAccount IDが件数応答にない | 一覧を1回再取得し、削除済みの行は消す。なお一覧に残る行で件数が欠ければ0件とせず「取得できません」と表示する | FR-007・008 |
| 件数の読み取りだけ失敗 | メニューは「取得できません」と再試行を表示し、行を選んで切り替えられる | FR-008 |
| Account AからBへ切り替えて投稿ストック・設定を開く | Bの投稿・設定だけが表示され、Aのデータは表示されない | SC-003 |
| 取得中の再開・失敗・連続開閉 | 前回の数や古い応答を現在の結果として表示しない | FR-007・008 |
| メニュー内に20件、スマートフォン幅 | 最後のAccountと追加操作にスクロール・キーボードで到達できる | FR-010 |
| Account追加・削除、下書き登録・承認・却下 | 開き直したメニューに現在のAccountと件数が出る | FR-007 |

## 手動確認：3つのAccountで作業先を選ぶ

1. 偽のThreadsに3人を登録する。以下は表示名の例。

   ```bash
   curl -fsS -X POST http://localhost:8790/__control/users -H 'Content-Type: application/json' -d '{"id":"9001","username":"kigi_cafe","name":"Kigi Cafe","picture":null}'
   curl -fsS -X POST http://localhost:8790/__control/users -H 'Content-Type: application/json' -d '{"id":"9002","username":"marron_studio","name":"Marron Studio","picture":null}'
   curl -fsS -X POST http://localhost:8790/__control/users -H 'Content-Type: application/json' -d '{"id":"9003","username":"design_soudan","name":"デザイン相談室","picture":null}'
   ```

2. Clerkでログインし、1件目を接続する。必要なら既存の `pnpm --filter api admin:set-plan <accountId> multi-account` で登録上限を上げる。2件目・3件目の接続の前に、偽のThreadsの既定ユーザーを切り替える。

   ```bash
   curl -fsS -X POST http://localhost:8790/__control/default-user -H 'Content-Type: application/json' -d '{"id":"9002"}'
   # 2件目を画面から接続する
   curl -fsS -X POST http://localhost:8790/__control/default-user -H 'Content-Type: application/json' -d '{"id":"9003"}'
   # 3件目を画面から接続する
   ```

3. 投稿ストックで、3件のAccountそれぞれに要確認の下書きを5件・2件・0件用意する。切り替えメニューを開く。
4. **期待**：同じメニュー内に5件・2件・0件と表示される。表示名、@ユーザー名、現在表示中の印が分かる。件数の多いAccountを選んで投稿ストックへ進める。3件のとき、選択から投稿ストックまで30秒以内。
5. 1件を承認または却下して、メニューを開き直す。**期待**：対象の件数が1減り、投稿ストックの「要確認」と一致する。別のAccountの件数は変わらない。
6. 3件目の偽ユーザーのトークンを無効にし、そのAccountを開き直して切断を検知させる。**期待**：次にメニューを開くと「要再接続」とそのAccountの要確認件数が一緒に表示される。
7. Accountを1件削除してメニューを開く。**期待**：削除したAccountの行がない。追加は既存の「アカウントを追加」から始められる。

## 手動確認：アカウント数と切り替え後の導線

- Accountが0件のユーザーでは、切り替えメニューではなく既存の初回追加画面に「Threadsアカウントを接続」が表示される。
- Accountが1件のユーザーでは、その1件の要確認件数と「アカウントを追加」がメニューに表示される。3件のユーザーでも各行と追加の操作が表示される。追加の可否は既存の条件に従う。
- Account AからBへ切り替え、Bの投稿ストックと設定を開く。Aの投稿・設定が表示されず、Bのデータだけが表示される。
- 要再接続のAccountを選び、そのAccountの画面に「再接続」の案内があることを確認する。

## 画面と速度

- PC 1280px、タブレット 768px、スマートフォン 390pxでメニューを確認する。ライト・ダークの両方で「要確認 N件」「表示中」「要再接続」が文字で読める。スマートフォンではドロワーから開き、行を選んだ後に閉じる。
- 20件の表示は、登録上限を変えずにWebのテスト用応答で再現する。末尾のAccountと「アカウントを追加」までスクロール・キーボードで到達できることを確認する。
- 3件保有時に、メニューを開いて全件と件数が見えるまでの時間を20回計測する。19回以上が2秒以内（SC-005）。件数取得のための呼び出しは、Accountの数によらず1回。
- 安定した通信下で、ブラウザの開発者ツールに表示される `GET /api/me/needs-review-counts` の応答時間を20回記録する。19回以上が500ms以内か確認し、測定条件と結果を `verification.md` に残す。
