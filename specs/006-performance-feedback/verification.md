# 006-performance-feedback 実装・確認の記録

確認日：2026-10-08。ブランチ：`feature/006-performance-feedback`。

## 実装した範囲

- **反応数の取り込み**（US1）：005の自動投稿の処理（`runAutoPost`）の最後に「反応数の段階」（`apps/api/src/services/metrics-runner.ts`）を足した。
  - 24時間・3日・7日の時点を、時刻の処理で±1時間の幅で取る。取りそこねた時点・遅れて確定・投稿IDのない投稿・フォロワー数は、日本時間3:00の補いで行い、1回で終わらなければ関所で5分後に続ける（KVの`metrics:catchup`）。
  - Threadsへの呼び出しは「24 − 8 × その回の公開の数」まで。DBの読み書きは、対象の読み込み・フォロワー数の対象・`db.batch`の書き込み・判定の4回程度にまとめた。
  - 投稿が見つからない→計測できません、権限がない→Accountに印（再接続で消す）、認証→要再接続、上限→その回を止めて次の回、一時的→記録しない。
  - 確定したときに、確定（遅れて確定を除く）の直近30件の中央値で1回だけ判定し、保存する。5件未満・基準値0では判定せず、5件目の確定でまとめて判定する。
- **画面**（US1）：サイドバーの「分析 > パフォーマンス」、基準値の欄、アイコンと件数のタブ、判定のバッジ（オレンジ・グレー・青の矢印と倍率、文字での説明は`title`と読み上げ）、確定待ち・遅れて確定・計測できませんのカード、50件ずつの表示、grower機能を使えないときの案内、反応数を読む許可がないときの案内。
- **改善フィードバック**（US2）：低調のタブで傾向メモ（200文字、入力欄から離れたときに保存）と「プロンプトに入れる」。外していない低調の新しい5件を、プロンプトの「■反応が低かった投稿」（却下の節の直後。長さの調整で減らさない）にメモ付きで入れる。投稿ストックのプロンプトのカードに件数を出す。
- **CSV**（US3）：「投稿ごと」（37列）と「取り込みごと」（13列）。APIが200件ずつJSONで返し、ブラウザでCSV（BOM・CRLF・すべて引用）に組み立てる。
- **分析のための記録**（FR-002e〜FR-002g）：本文を人が直したか、公開した時刻の枠・持ち越し・「次に投稿する」、バッチ登録時のプロンプトの材料の版（課題・宣伝内容・リサーチ・投稿ルールの最終更新）。
- **データ**：マイグレーション`0008_performance.sql`（列挙型3つ、表3つ、`post_drafts`・`draft_batches`・`accounts`の列）。既存の下書きは「本文を直したか」を不明（`body_edit_tracked = false`）にし、宣伝内容・リサーチの変更の日時は既存の行の更新日時で埋めた。
- **手動確認のデータ**：`pnpm --filter api seed:performance <accountId> [件数]`（ローカルのDBだけ）。

## 設計からの変更・補足

- **関所の待ちの上限**：予定がないときの「次に見る時刻」が、24時間後から「翌日の3:00（反応数の補い）」に早まった（005の関所のテストを直した）。
- **CSVの文字数**：契約では「書記素の数」と書いていたが、003と同じ`countChars`（コードポイントの数。DBの`char_length`と同じ）にそろえ、契約を直した。
- **宣伝内容・リサーチの変更の日時**：各ルートで保存の後に入れる（`apps/api/src/services/materials.ts`）。分析のための記録なので、入れられなくても元の操作は失敗にせず、ログに出す。投稿ルールは、Accountの行を更新する同じ書き込みの中で入れる。
- **分析のための記録のテスト**：tasks.md T038 では既存の4つのテストファイルに分けて書く予定だったが、`apps/api/test/integration/analysis-records.test.ts`にまとめた。
- **画面案の曜日**：画面案では2026-09-25を「(木)」と書いていたが、実際は金曜日。実装は正しい曜日を出す。

## 自動確認

`pnpm lint`・`pnpm typecheck`・`pnpm test`・`pnpm build`が通った。

| 対象 | 確認したテスト数 |
|---|---:|
| 共通パッケージ | 181 |
| Web | 197 |
| API | 349 |

本featureで足した主なテスト：`packages/shared/test/performance.test.ts`・`csv.test.ts`・`prompt.test.ts`（節）、`apps/api/test/integration/metrics-runner.test.ts`・`performance.test.ts`・`threads-insights-client.test.ts`・`analysis-records.test.ts`、`apps/web/test/performance.test.tsx`。005の`auto-post-gate.test.ts`・`auto-post-runner.test.ts`、001の`reconnect.test.ts`・`data-deletion.test.ts`、003の`prompt.test.ts`、Webの`stock.test.tsx`にも確認を足した。

- 1回の定期処理の外部への呼び出しが50回以下（公開のない回でThreadsへの呼び出し24回）であることを、偽の`fetch`で数えて確かめた（research.md R3）。
- 投稿済み500件のAccountで、`GET /performance`が500ms以内に返ることを確かめた（ローカルのPostgres。SC-007）。

## 残っている手動確認

- [ ] quickstart.md の「手動の確認」1〜5・8・9（偽のThreadsで、画面の見た目・保存・CSVを表計算ソフトで開く・500件での表示の速さ・画面幅）。tasks.md T050。
- [ ] quickstart.md の手順6（本物のThreads）：テスター招待したアカウントで、24時間後の取り込み、投稿を削除したときのエラーの応答（コード・サブコード）、`views`の応答の形を記録し、`ThreadsNotFoundError`の判定と応答の読み方が合っているか確かめる（research.md R1 の要確認）。tasks.md T051。
