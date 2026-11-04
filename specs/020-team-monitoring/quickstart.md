# Quickstart：チームの運用状況を見る

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md)

## 1. 自動のテスト

```bash
pnpm --filter ./apps/api test -- team-status
pnpm --filter ./apps/web test -- team-status team-page invite-page
pnpm --filter ./packages/shared test && pnpm --filter ./apps/api test && pnpm --filter ./apps/web test && pnpm lint && pnpm -r exec tsc --noEmit
```

確かめること（API）：
- 見られる人：管理者200（すべて）、担当のある編集者200（担当の分だけ）、担当のない編集者・メンバー `ROLE_FORBIDDEN`、チームの人でない `TEAM_NOT_FOUND`、チームのまとまりがOFF `FEATURE_DISABLED`
- 範囲：編集者の結果に、担当の外の人・Account・件数が入らない。オーナーの行の動きは、担当のアカウントでの動きだけ。オーナーのチームがOFFの担当のAccountは入らない。担当を外すと、次の読み込みから消える
- 止まっている：入って8日・記録なし→印、入って3日・記録なし→印なし、8日前に承認→印、今日案を作った→印なし。Accountは投稿の日で同じ
- 90日：入って100日・記録なし→`retentionLimited`
- 伸び：前の30日と直近30日に確定した投稿を5件ずつ作り、中央値の比が0.6→`poor`、1.3→`ok`、どちらかが4件→`insufficient`、オーナーの自動投稿がOFF→`metrics_off`。確定待ちの投稿は数えない
- 並び：止まっている→伸びていない→それ以外
- 中身を返さない：応答に投稿の本文・戦略の文字が入らない
- `GET /api/teams/:teamId` の `statusVisible`

## 2. 手元で試す

1. `pnpm team:demo` で確認用のチームを作る（管理者・編集者・メンバーとAccountが入る）。
2. 管理者でチームの画面を開く。「担当を決める」の左に「運用状況」が出る。押すと、人とアカウントが並ぶ。
3. 編集者のAccountで案を1件作り、運用状況を開き直す。その編集者の「最後に動いた日」が「今日」になる。
4. 編集者でチームの画面を開く。担当があれば「運用状況」が出て、担当のアカウントとそのオーナーだけが並ぶ。
5. メンバーでチームの画面を開く。「運用状況」は出ない。
6. 招待のリンクを開き、確認の画面に、管理者と担当の編集者に見える範囲の説明があることを確かめる。
7. スマートフォンの幅（390px）で、運用状況が横にスクロールせずに見られることを確かめる。

## 3. テスト版で確かめる（マージのあと）

テスト版で、管理者・編集者・メンバーの3人でチームを作り、2〜7と同じことをスマートフォンでも確かめる。伸びは確定した投稿が要るので、投稿して7日たったAccountで確かめる。
