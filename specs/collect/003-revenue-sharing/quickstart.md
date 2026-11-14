# 確かめ方（quickstart）：売上・経費・紹介と、運営メンバーへの分配

**前提**：001・002 が入ったステージング（API `threads-grower-api-staging`・画面 `develop.threads-grower-web`）。主催者（集金管理の利用の許可あり）と、別の利用者（利用の許可なし。テスト版には入れる）の2人。

## 手元のテスト

```bash
pnpm --filter @meguru/shared test -- distribution     # 分配の計算（spec の例・端数・赤字・傾斜の上限）
pnpm --filter api test -- collect/sharing             # API（経費・運営メンバー・招待・つながった人）
VITE_API_BASE_URL=http://localhost:8787 pnpm --filter web test -- collect/sharing
pnpm e2e -- collect-sharing                           # 主催者と招待された人の2つのブラウザ
```

## ステージングで

1. 主催者でイベントを作り、名簿に5人（紹介した人：井上3人・木村2人）を入れて受付する（現金・PayPay・振込待ちを混ぜる）。
2. 締めの画面の「分配」から、経費「会場費 20,000円（立て替え：主催者）」を入れる → 残る額（今・見込み）が出る（spec User Story 1）。
3. 運営メンバーを3人足す（リーダー1：主催者・メンバー3）→ 分配額と内訳が出て、合計が残る額と同じ（User Story 2）。傾斜を1.5にして出し直す。上限より大きい傾斜は入れられない。
4. 紹介経由の売上に、井上・木村・紹介なしの行が出る（User Story 3）。分配の額は変わらない。
5. 運営メンバー「木村」の招待のリンクを出し、別の利用者でログインして開き、受ける → 「運営メンバーのイベント」に出て、分配の木村の行に「あなた」と出る。名簿・参加者の名前は出ない（User Story 5）。
6. 主催者が「つながりを外す」→ 別の利用者で開き直すと、見られない。
