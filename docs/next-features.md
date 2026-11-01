# 次の機能のメモ（仕様づくりの前）

**最終更新**：2026-10-31

**位置づけ**：ユーザーと話して決めたこと・まだ決めていないことを、`/speckit-specify`の前に残すメモ。各機能の仕様（`specs/NNN-…/spec.md`）を作るときの入力にし、移したらこのメモからは消す。決済のメモは[specs/013-billing/notes.md](../specs/013-billing/notes.md)。

## 順番（2026-10-12 決定）

1. 010 自分のMetaアプリのトークンでアカウントを追加（[PR #12](https://github.com/takumi-okuya-dev/threads-grower-app/pull/12)、2026-10-13 にマージ）
2. 011 チームの見直し（[PR #14](https://github.com/takumi-okuya-dev/threads-grower-app/pull/14)、2026-10-14 にマージ。仕様は[specs/011-team-revision](../specs/011-team-revision/spec.md)）
3. 012 アカウントを先に作る（[PR #15](https://github.com/takumi-okuya-dev/threads-grower-app/pull/15)、2026-10-14 にマージ。仕様は[specs/012-accounts-before-connect](../specs/012-accounts-before-connect/spec.md)）
4. **013 決済＋退会**（2026-10-15、退会を決済といっしょに作ると決めた。メモは[specs/013-billing/notes.md](../specs/013-billing/notes.md)）

- チームの見直しを先にするのは、権限の判定の中心（`authorizeAccount`）を変えるため。アカウントを先に作る機能は、チームに入れるアカウントの扱いにも関わるので、その後に作る。
- どちらも決済の前に入れる。決済の無料体験・登録数の上限は、アカウントの数え方とチームの形が決まってから決める。

### 番号の付け方（2026-10-13 決定）

- 011＝チームの見直し、012＝アカウントを先に作る、013＝決済。`specs/011-billing/`は`specs/013-billing/`に移した。008の文書・PRDの「011（決済）」は「013（決済）」に直した。
- 番号を付け直すたびに文書を直さずに済むよう、Constitution では決済を番号で書かず「最後の feature」と書く（011の改定のときに直す）。

## C. 公開後のブランチと環境

2026-10-22に、feature 015「公開のためのブランチと環境」に移した（[specs/015-deploy-environments](../specs/015-deploy-environments/spec.md)）。このメモでは扱わない。

## D. 退会

2026-10-15 に、決済（013）といっしょに作ると決めた。メモは[specs/013-billing/notes.md](../specs/013-billing/notes.md)の「4. 退会」に移した。

## E. テスト用のグループと紹介リンク

2026-10-31に、ユーザーが2つの機能を挙げ、別々のfeatureにすると決めた。

1. **016 テスト用のグループ**：テスト環境を組織やコミュニティの単位で渡し、グループごとに人数の上限を設ける。仕様は[specs/016-test-groups](../specs/016-test-groups/spec.md)に移した。
2. **017 紹介リンク**：利用者が自分の紹介リンクを共有し、リンクを開いた人にアカウントを作ってもらう。誰の紹介で登録したかを記録する。

017は2026-11-01に、特典は付けない・テスト環境では紹介リンクだけでは入れない・紹介した人には人数だけを見せる、と決めた。仕様は[specs/017-referral-links](../specs/017-referral-links/spec.md)に移した。
