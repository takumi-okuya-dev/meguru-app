# 画面の契約：Threadsで許可するときのアカウントの取り違えを減らす案内

**日付**：2026-11-08 | **計画**：[../plan.md](../plan.md) | **モック**：[025 アカウントの取り違えの案内 モック](https://claude.ai/artifact/9hc14FMaeTytHEAkuNiaLH)

- **見た目**：今の部品（`Alert`・`Toggle`・`Button`）と024の枠にそろえる。新しい強調の色や形は使わない。
- **出す相手**：オーナーにだけ出す（接続の操作と同じ）。
- **文言**：文と手順は`packages/shared/src/threads-account-guide.ts`から出す（data-model.md 3）。

## 1. 押す前の案内（`ThreadsAccountGuide`、US1・モック1・2枚目）

- **置き場所**：「Threadsで許可する」のすぐ下に、枠（`Alert`の通常の形）で置く。

  | 画面 | 使うべきアカウント |
  |---|---|
  | `ConnectMethods`（招待の管理がOFF） | なし |
  | `TesterApplicationPanel`の招待済み | 申し込んだユーザー名 |
  | `ReconnectDialog`（「Threadsで許可する」を選べるときだけ） | `account.username` |

- **中身**：
  - `accountGuideLead(expected)`の1文。@ユーザー名は太字にする。
  - 閉じたトグル「違うアカウントが出たときは」。開くと、`accountSwitchSteps(expected, "Threadsで許可する")`の3行（箇条書き）と、「threads.comを開く」の文字のリンク（新しいタブ）を出す。
- **トークンの貼り付けの画面には出さない**（FR-004）。

## 2. 違うアカウントで戻ったとき（`AccountSwitchSteps`、US2・モック3枚目）

- **出すとき**：戻りのエラーが`ACCOUNT_SWITCH_ERRORS`のどれかのとき、エラーの枠（`Alert`の失敗の形）の中に、エラーの文に続けて出す。
  - 手順：`accountSwitchSteps(expected, again)`の3行（番号つき、閉じずに出す）。
  - 「threads.comを開く」：枠線のボタン（`Button variant="outline"`、新しいタブで開くリンク）。
- **画面ごとの違い**：

  | 画面 | `expected` | `again` |
  |---|---|---|
  | つながっているアカウントの「Threadsとの接続」 | `account.username` | 「接続し直す」 |
  | `ConnectMethods`（招待の管理がOFF） | なし | 「Threadsで許可する」 |
  | `TesterApplicationPanel`の招待済み | 申し込んだユーザー名 | 「Threadsで許可する」 |

- **`ACCOUNT_ALREADY_REGISTERED`**：今の「そのアカウントを開く」のリンクも残す。
- **つながっているアカウントの「Threadsとの接続」**（research.md R2）：
  - 戻りのエラーがあれば、手順を出さないエラーでも、エラーの文を枠で出す。
  - 「接続し直す」のボタンは、今の位置のまま。

## 3. 違うアカウントでつながった知らせ（`ConnectionNotice`、US3・モック4枚目）

- **置き場所**：つながっているアカウントの「Threadsとの接続」の区分の、説明の上。
- **出すとき**：`GET /api/accounts/:id/connection-notice`の`otherAccount`に値があるとき。オーナーだけ。
- **中身**：
  - 枠（`Alert`の通常の形、注意の印）に、「@{connectedUsername} でつながりました。申し込んだ @{appliedUsername} とは違うアカウントです。」
  - 箇条書き2行：
    - 「このままでよければ、閉じてください」
    - 「@{appliedUsername} でつなぎ直すときは、threads.comで @{appliedUsername} にログインし直してから「接続し直す」を押す」
  - 「閉じる」（枠なしのボタン）。押すと`POST …/dismiss`を送り、知らせを消す。
