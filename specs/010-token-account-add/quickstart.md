# Quickstart：自分のMetaアプリのトークンでアカウントを追加

**日付**：2026-10-10 | **計画**：[plan.md](./plan.md)

本featureが動くことを確かめる手順。準備は001〜009と同じ（[README](../../README.md)、OrbStackで`docker compose up -d`、`pnpm dev:fake`）。

## 1.自動のテスト

```bash
pnpm lint && pnpm typecheck
pnpm test                 # 共通・Web・API（API はローカルのPostgresを使い、表を空にする）
pnpm e2e -- token         # 偽のThreadsのトークンで追加・接続し直し（E2Eの準備は README）
pnpm e2e -- team          # 008の流れが変わらないこと
```

確かめること（対応するテストはtasks.md）：

| 確かめること | 出どころ |
|---|---|
| 有効な長期トークンでAccountができ、プロフィールが出る | US1-3、FR-010 |
| 投稿・反応数の権限がないトークンでも作られ、案内が出る | US1-4・US1-5、FR-011 |
| 無効・形が違う・短期のトークンは作られない | US1-6、FR-003・FR-012 |
| `debug_token`が読めないときは作られ、2時間後の確かめ直しで要再接続になる | FR-012、research.md R3・R8 |
| 二重登録の3通り（このアプリ→トークン、トークン→このアプリ、トークン→別のMetaアプリのトークン）でAccountは1つ | SC-003、FR-020〜FR-023 |
| 接続し直しで方法を切り替えても、投稿ストック・戦略・設定・記録の件数が同じ | SC-005、FR-033 |
| 別のThreadsアカウントのトークンでの接続し直しは拒まれる | US3-4、FR-032 |
| パートナー・編集者は`token-connect`の接続し直しで`ROLE_FORBIDDEN` | FR-034（`permissions-matrix.test.ts`） |
| 10分に5回失敗すると10分待ち | FR-015 |
| トークンが応答・ログ・記録・書き出しに出ない | SC-004、FR-043 |
| トークンの接続も日次で延長される | SC-006、FR-040 |
| 追加の画面は、2つ目の方法を開かなければ今と同じ | SC-007 |

## 2.偽のThreadsで手で確かめる

1. `pnpm dev:fake`で起動し、`http://localhost:5173`でログインする。
2. 偽のThreads（`http://localhost:8790/__control/token-page`）の「トークンを作る」で、@cafe_b・長期・`debug_token`あり・3つの権限のトークンを作り、コピーする。
3. 「Threadsアカウントを追加」→「自分のMetaアプリのトークンで追加する」を開き、貼り付けて「追加する」。@cafe_bのホームに移る。
4. 設定の「Threadsとの接続」に「今の接続：自分のMetaアプリのトークン」が出る。
5. もう一度、同じ@cafe_bで別のアプリ（`appScope`を変える）のトークンを作って追加 →「このアカウントはすでに登録されています」。
6. 設定の「接続し直す」→「Threadsで許可する」→ 偽のThreadsで「@cafe_bで許可する」。「今の接続：このアプリで許可」に変わり、投稿ストックが残っている。
7. 形の違う文字列で5回「追加する」→ 6回目に「あと10分」。
8. `debug_token`なしのトークンで追加し、偽のThreadsでそのトークンを無効にしてから、`recheck_at`を過去にして5分ごとの処理を動かす（`curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=*/5+*+*+*+*"`）→ 要再接続と「短期トークンだった可能性があります」。

## 3.実際のMetaアプリで確かめる（手動）

1. 自分のMetaアプリ（例：ThreadsAutomation）のユーザートークン生成ツールで長期トークンを作る。
2. ステージング（またはローカルを本物のThreadsに向けた環境）で追加する。`debug_token`の応答の形をresearch.md R3の末尾に書く。
3. `/guide/threads-token`の手順を、Metaアプリを持っていない人の目で読み、手順どおりに進められるかを確かめる（SC-002）。
4. 結果を`verification.md`に書く。
