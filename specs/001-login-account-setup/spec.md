# Feature Specification: ログインとThreadsアカウント登録

**Feature Branch**: `001-login-account-setup`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "Login & account setup — PRD FR-1（Googleログイン）とFR-2（Threadsアカウントの登録）。他のすべての機能の土台となる。"

**Source**: [PRD §4.1](../../_bmad-output/initiative-threads-grower-app/prd-threads-grower-app/prd-threads-grower-app.md)（FR-1, FR-2）、UJ-1・UJ-4の入口部分

## Clarifications

### Session 2026-10-01

- Q: Account.planはAccount単位だが、ユーザーの登録数上限はどのプラン情報から決めるか？ → A: そのユーザーが保有するAccountのうち最上位のプランで決める。2件目以降の新規Accountはそのプランを引き継ぐ。
- Q: プラン3で1ユーザーが登録できるAccount数の上限は？ → A: 5件。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 初回ログインと最初のThreadsアカウント登録 (Priority: P1)

Accountを1件も持たない新規ユーザーがGoogleアカウントでログインし、アカウント追加画面に案内される。そこで自分のThreadsアカウントを接続すると、そのThreadsアカウントがAccountとして登録され、そのAccountの管理画面に入る。

**Why this priority**: これがないと戦略設計・投稿ストック・自動投稿のどれも始められない。UJ-1の入口であり、SM-1（自分以外のアクティブAccount数）の分母そのものである。

**Independent Test**: 新しいGoogleアカウントでログインしてThreadsアカウントを1件接続し、登録したAccountの管理画面（中身は空でよい）が表示されることを確認する。このストーリーだけで「ログインして自分のThreadsアカウントがアプリに紐づいた」という価値が成立する。

**Acceptance Scenarios**:

1. **Given** Googleでログインしたことのないユーザー、**When** ログイン画面で「Googleでログイン」を選んでGoogle側で許可する、**Then** ユーザーが新規作成され、アカウント追加画面に遷移する。
2. **Given** ログイン済みでAccountを持たないユーザーがアカウント追加画面にいる、**When**「Threadsアカウントを接続」を選んでThreads側の認可画面で許可する、**Then** そのThreadsアカウントのユーザー名とプロフィール画像を表示するAccountが作成され、そのAccountの管理画面に遷移する。
3. **Given** ログイン済みでAccountを持たないユーザー、**When** アプリ内のAccountを必要とする画面に直接アクセスする、**Then** アカウント追加画面に誘導される。
4. **Given** ユーザーがThreads側の認可画面でキャンセルする、**When** アプリに戻る、**Then** Accountは作成されず、アカウント追加画面に「接続がキャンセルされました」と再試行の手段が表示される。

---

### User Story 2 - 再訪時のログインと保護された画面 (Priority: P2)

Accountを1件以上持つ既存ユーザーがログインすると、最後に使っていたAccountの画面に直接戻る。ログインしていない人はアプリの保護された画面を見られない。ユーザーはいつでもログアウトできる。

**Why this priority**: 日々の運用で毎回Accountを選び直す手間をなくし、未認証のアクセスから運用データを守る。P1ができた後、継続利用するために必要になる。

**Independent Test**: Accountを持つユーザーで一度ログアウトし、保護された画面へのアクセスがログイン画面に誘導されること、再ログイン後に最後に使ったAccountの画面に戻ることを確認する。

**Acceptance Scenarios**:

1. **Given** 未ログインの訪問者、**When** アプリの保護された画面にアクセスする、**Then** ログイン画面にリダイレクトされ、保護された内容は一切表示されない。
2. **Given** Accountを1件以上持ち、前回Account Aを使っていたユーザー、**When** ログインに成功する、**Then** Account Aの画面に遷移する。
3. **Given** 前回使っていたAccountがその後削除されているユーザー、**When** ログインに成功する、**Then** 残っている別のAccountの画面に遷移する（残りが0件ならアカウント追加画面に遷移する）。
4. **Given** ログイン中のユーザー、**When** ログアウトする、**Then** セッションが終了し、ログイン画面に戻り、ブラウザの「戻る」操作でも保護された画面が表示されない。

---

### User Story 3 - プランに応じた複数Accountの登録 (Priority: P3)

複数アカウント運用を許可するプランのユーザーは、2件目以降のThreadsアカウントを追加登録できる。許可されていないプランのユーザーが追加しようとすると、上限に達していることとアップグレードで追加できることが案内される。

**Why this priority**: UJ-4（運用代行ユーザーの複数アカウント運用）と、プロダクトオーナー自身の「たくみ」「AI部」2アカウント運用の前提になる。ただし1Accountだけでもコアループは検証できるためP1・P2より後。

**Independent Test**: 複数アカウントを許可するプランのユーザーで2件目のThreadsアカウントを接続し、2件のAccountが一覧に並ぶことを確認する。1アカウントプランのユーザーでは追加が拒否されアップグレード案内が出ることを確認する。

**Acceptance Scenarios**:

1. **Given** 複数アカウントを許可するプランで、上限に達していないユーザー、**When** 別のThreadsアカウントを接続する、**Then** 2件目のAccountが作成され、Account一覧に表示される。
2. **Given** 1アカウントのみ許可するプラン（プラン1・2）でAccountを1件持つユーザー、**When** アカウント追加を試みる、**Then** Threads側の認可に進む前に、上限に達していることとプラン3以上で追加できることが案内され、Accountは作成されない。
3. **Given** Accountを2件以上持つユーザー、**When** Account一覧から別のAccountを選ぶ、**Then** そのAccountの画面に切り替わり、それが「最後に使ったAccount」として記録される。

---

### User Story 4 - Threads接続の再接続とAccountの削除 (Priority: P4)

Threads側の接続が期限切れ・取り消しなどで無効になったAccountは「要再接続」と表示され、ユーザーはThreads側で再度認可するだけで接続を復旧できる。不要になったAccountは確認のうえ削除できる。

**Why this priority**: 自動投稿（FR-8）が動き出すと接続切れは運用停止に直結するが、登録直後の段階では発生頻度が低い。後続featureの前提として本featureで状態と復旧手段を定義しておく。

**Independent Test**: Account接続を無効化した状態（Threads側で連携を解除する等）で、そのAccountに「要再接続」が表示され、再接続後に通常状態へ戻ることを確認する。別途、Accountを削除して一覧から消え、接続情報も残らないことを確認する。

**Acceptance Scenarios**:

1. **Given** Threads接続が無効になったAccount、**When** ユーザーがそのAccountの画面を開く、**Then** そのAccountに「要再接続」の表示と再接続の操作が出て、以後はAccount一覧でも「要再接続」と表示される。
5. **Given** 登録数上限に達しているユーザーの「接続中」のAccount、**When** 設定画面から同じThreadsアカウントで認可し直す、**Then** Accountは増えずに接続情報が更新される。
2. **Given**「要再接続」のAccount、**When** ユーザーが再接続を選び、同じThreadsアカウントでThreads側の認可を完了する、**Then** 同じAccountが（新規作成されずに）通常状態に戻り、既存の関連データはそのまま残る。
3. **Given**「要再接続」のAccount、**When** ユーザーが再接続で別のThreadsアカウントを認可する、**Then** 再接続は拒否され、元のThreadsアカウントで認可する必要があると案内される。
4. **Given** Accountを持つユーザー、**When** Accountの削除を選び、確認ステップでAccount名を入力して確定する、**Then** そのAccountと接続情報が削除され、一覧から消え、プランの登録数上限のカウントからも外れる。

---

### Edge Cases

- Google側の認証でユーザーがキャンセルした、またはGoogle側でエラーが発生した場合は、ログイン画面に戻り、原因のわかるメッセージと再試行の手段を表示する。
- ユーザーがGoogleアカウントのメールアドレスやプロフィール名を変更しても、同じGoogleアカウントであれば同一ユーザーとして扱い、既存のAccountにそのままアクセスできる。
- ユーザーが自分ですでに登録済みのThreadsアカウントをもう一度接続した場合は、Accountを重複作成せず、既存Accountの接続を更新する（実質的な再接続として扱う）。
- 他のユーザーがすでに登録しているThreadsアカウントを接続しようとした場合は、登録を拒否し「このThreadsアカウントは別のユーザーが登録済みです」と案内する（プラン4のチーム共有はスコープ外）。
- 検証期間中、アプリ側の利用者として許可されていないThreadsアカウントで認可しようとした場合（Meta App Review通過前の制約）、認可失敗としてその旨と問い合わせ先を案内する。
- Threads側の認可は通ったが、Account作成に必要な情報（ユーザー名など）を取得できなかった場合は、Accountを中途半端な状態で作らず、エラーを表示して再試行させる。
- 同じユーザーが複数のブラウザタブから同時にアカウント追加を行い、上限を超えそうになった場合でも、プランの登録数上限を超えるAccountは作成されない。
- 最上位プランのAccountを削除した、またはプランが下がった結果、保有Account数が新しい上限を超えた場合でも、既存のAccountは削除・停止せずに残す。ただし上限を下回るまで新しいAccountは追加できない。
- ユーザーがThreads側の設定から、このアプリに渡した自分のデータの削除を求めた場合は、そのThreadsアカウントに対応するAccountを関連データごと削除し、要求の処理状況（処理中・完了）を確認できるようにする。
- セッションが有効期限切れになった状態で操作した場合は、入力途中の内容が失われる可能性を明示したうえでログイン画面に誘導し、再ログイン後は最後に使っていたAccountの画面に戻す。

## Requirements *(mandatory)*

### Functional Requirements

**ログイン・セッション（PRD FR-1）**

- **FR-001**: System MUST ユーザーにGoogleアカウントでのログイン手段を提供する。MVPでは他のログイン手段（メール＋パスワード等）は提供しない。
- **FR-002**: System MUST Googleアカウントでの初回ログイン時にユーザーを自動作成し、以降は同じGoogleアカウントでのログインを同一ユーザーとして識別する（メールアドレス変更の影響を受けない）。
- **FR-003**: System MUST 未ログイン状態でのアプリの保護された画面へのアクセスをログイン画面へリダイレクトし、保護された内容を表示しない。
- **FR-004**: System MUST ログイン成功後、ユーザーがAccountを1件以上持つ場合は最後に使っていたAccountの画面に遷移させる。最後に使っていたAccountが存在しない場合は、残っているAccountのうちもっとも新しく使われたもの（なければもっとも新しく作成されたもの）の画面に遷移させる。
- **FR-005**: System MUST ログイン成功後、ユーザーがAccountを1件も持たない場合はアカウント追加画面に遷移させる。
- **FR-006**: Users MUST be able to ログアウトでき、ログアウト後はブラウザ履歴からも保護された画面を表示できない。
- **FR-007**: System MUST ユーザーがAccountを切り替えるたびに、そのAccountを「最後に使ったAccount」として記録する。

**Threadsアカウントの登録・接続（PRD FR-2）**

- **FR-008**: Users MUST be able to アカウント追加画面からThreads側の認可画面へ進み、自分のThreadsアカウントへのアクセスを許可することでAccountを登録できる。アクセストークン等の認証情報をユーザーが手で入力・貼り付ける方式は提供しない。
- **FR-009**: System MUST Account作成時に、Threadsアカウントのユーザー名・表示名・プロフィール画像を取得してAccountに表示する。
- **FR-010**: System MUST Threads接続の認証情報を保存時に暗号化し、画面・ログ・エラーメッセージ・エクスポートのいずれにも平文で出さない。
- **FR-011**: System MUST Account作成時に、作成したユーザーをそのAccountの`owner`とするMembershipを作成する。プラン1〜3ではMembershipやロールの概念を画面に表示しない（Constitution 原則IV・V）。
- **FR-012**: System MUST 1つのThreadsアカウントを複数のユーザーがそれぞれ別のAccountとして登録することを拒否する。
- **FR-013**: System MUST ユーザーがすでに自分のAccountとして登録済みのThreadsアカウントを再度接続した場合、新しいAccountを作らず既存Accountの接続を更新する。
- **FR-014**: System MUST 新規作成したAccountに初期プランを設定する。ユーザーの最初のAccountは`auto-only`（プラン1）とし、2件目以降のAccountはその時点でユーザーが保有するAccountのうち最上位のプランを引き継ぐ。プランの契約・変更・課金はPRD FR-12（別feature）で扱う。

**プランによる登録数上限**

- **FR-015**: System MUST ユーザーが登録できるAccount数を、プランに応じた上限で制限する：プラン1・2は1件、プラン3は5件。プラン4の上限はプラン4のfeatureで定め、それまではプラン3と同じ5件として扱う。
- **FR-016**: System MUST ユーザーの登録数上限を、そのユーザーが`owner`として保有するAccountのうち最上位のプランに基づいて判定する（例：`multi-account`のAccountを1件でも保有していれば上限は5件）。
- **FR-017**: System MUST 上限に達したユーザーがアカウント追加を試みた場合、Threads側の認可に進む前に上限到達とアップグレード手段を案内し、Accountを作成しない。同時操作でも上限を超えるAccountが作成されないこと。

**接続状態の管理・削除**

- **FR-018**: System MUST 各AccountのThreads接続状態を「接続中」「要再接続」の2状態で保持し、接続が期限切れ・取り消し・認証エラーで無効になったことを検知したら「要再接続」に変える。検知の機会には、ユーザーがそのAccountの画面を開いたときの接続確認を含める。
- **FR-019**: System MUST「要再接続」のAccountについて、Account一覧とそのAccountの画面に状態と再接続の操作を表示する。Account一覧には、その時点までに検知した状態を表示する。
- **FR-020**: Users MUST be able to 自分のAccountの接続を、同じThreadsアカウントでThreads側の認可をやり直すことで更新できる。「要再接続」のAccountはこれで接続中に戻る。この操作は「接続中」のAccountでも使え、新しいAccountを作らないため登録数上限に達していても使える。別のThreadsアカウントでの再接続は拒否する。
- **FR-021**: System MUST Threads接続の有効期限が延長可能な場合、期限切れ前に自動で延長し、ユーザーの操作なしで「接続中」を維持する。
- **FR-022**: Users MUST be able to 自分のAccountを削除できる。削除には取り消せない旨の明示とAccount名の入力による確認を必要とし、確定するとAccount・接続情報・Accountに紐づくデータを削除する。
- **FR-023**: System MUST ログイン失敗、Threads認可のキャンセル・失敗、上限到達、他ユーザー登録済みなどの各エラーで、原因と次に取れる操作をユーザーにわかる言葉で表示する。

### Key Entities *(include if feature involves data)*

- **User**: アプリを使う個人。Googleアカウントと1対1で対応し、Googleアカウント上の不変の識別子で同一性を判定する。表示名・メールアドレス・最後に使ったAccountを持つ。
- **Account**: Threadsアカウント1件に対応する運用単位（PRD Glossary）。Threadsアカウントの識別子・ユーザー名・表示名・プロフィール画像、`plan`（`auto-only` / `auto-grower` / `multi-account` / `team`）、接続状態、作成日時、最終利用日時を持つ。1つのThreadsアカウントにつきAccountは最大1件。
- **Membership**: User×Accountの関係。`role`（`owner` / `member`）を持つ。本featureではAccount作成者を`owner`とするMembershipだけが作られる。`member`はプラン4限定でスコープ外（Constitution 原則IV）。
- **Threads接続（Threads Connection）**: AccountがThreadsへアクセスするための認証情報と有効期限。暗号化して保持し、Accountと1対1で対応する。Account削除時に同時に削除される。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 新規ユーザーが、ログイン画面を開いてから最初のAccountの画面に到達するまでを3分以内に完了できる（Google・Threadsのアカウントにはログイン済みの前提）。
- **SC-002**: 限定テスターのうち90%以上が、説明なしで初回のログインとThreadsアカウント登録を完了できる。
- **SC-003**: 未ログイン状態での保護された画面へのアクセスは100%ログイン画面に誘導され、保護された内容が表示されることはない。
- **SC-004**: Accountを持つユーザーの再ログインのうち100%で、最後に使っていたAccount（削除済みの場合はFR-004に定める代替のAccount）の画面に直接遷移する。
- **SC-005**: Threads接続の認証情報が画面・ログ・エラーメッセージ・エクスポートに平文で現れる件数が0件である。
- **SC-006**: プランの登録数上限を超えたAccount、および複数ユーザーに重複登録されたThreadsアカウントの件数が0件である。
- **SC-007**: 接続が無効になったAccountは、次にユーザーがそのAccountの画面を開いた時点で100%「要再接続」と表示され、以後はAccount一覧でも「要再接続」と表示される。再接続は1分以内に完了できる。
- **SC-008**: MVPローンチ後1〜2か月で、プロダクトオーナー以外のユーザーが登録したアクティブAccountが3〜5件ある（PRD SM-1、暫定目標）。

## Assumptions

- ログイン手段はGoogleのみとする（PRD FR-1）。メール＋パスワード、他のSNSでのログインはMVPのスコープ外。
- Threadsアカウントの接続は、Threads（Meta）公式の認可画面でユーザーが許可する方式とする。トークンを手で貼り付ける方式は、セキュリティと操作の分かりやすさの理由で提供しない。
- MVPはMeta App Review通過前のローカル／ステージング環境での検証を優先する（PRD §6.2）。そのため接続できるThreadsアカウントは、アプリ側でテスターとして許可したアカウントに限られる。
- 課金・プラン変更（PRD FR-12）は別featureとする。本featureではAccountの`plan`を保持して上限判定に使うだけで、課金フローは持たない。課金feature完成までの検証期間中は、運営者（プロダクトオーナー）がプランを手動で設定できる前提とする。
- 新規Accountの初期プランはFR-014に従う（ユーザーの最初のAccountは`auto-only`（プラン1）、2件目以降は保有Accountの最上位プランを引き継ぐ）。プラン1の無料期間の開始・終了の管理は課金featureで扱う。
- ログインセッションはログインから7日間有効とし、明示的なログアウトまたは期限切れで終了する（月額固定費$0の制約のため、認証基盤の無料枠の既定値に合わせる。[research.md R2](./research.md)参照）。
- プラン4（チーム管理：招待、`member`ロール、Membership管理画面）はスコープ外（Constitution 原則V、PRD §6.2）。他ユーザーと同じThreadsアカウントを共有する運用はプラン4で扱う。
- Account削除時の関連データ（戦略プロファイル、投稿ストック等）は後続featureで追加されるものも含め、Accountと一緒に削除する。削除後の復元手段は提供しない。
- Account一覧やAccountの切り替えなど、マルチアカウント・ダッシュボードの本格的な機能（承認待ち件数の表示など、PRD FR-11）は別featureとし、本featureでは「一覧から選んで切り替える」最小限だけを扱う。
- 画面の文言は日本語とする。
