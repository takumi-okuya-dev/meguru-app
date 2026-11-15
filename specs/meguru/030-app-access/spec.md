# Feature Specification：運営者が開いた人だけが使えるアプリ（アプリの利用の許可）

**Feature Branch**: `feature/meguru-030-app-access`

**Created**: 2026-11-13

**Status**: Draft

**Input**: 2作目の集金管理（[specs/collect/001-event-day-collection](../../collect/001-event-day-collection/spec.md)）の最初の版は、テストのグループの人だけが無料で使う（collect 001 Clarifications・FR-003）。人物メモ（specs/people/001-people-memo）も同じく「既定でOFF・運営者がONにした人だけ・無料」と決めた（2026-11-13）。今のめぐるには、アプリを「人ごとに使える・使えない」にする仕組みがない（`/api/me`の`available`はすべての人に同じ一覧を返す）。集金管理の作業の一覧（collect 001 tasks.md の PR0）は、これを共通の小さなPRで先に入れると決めている。

**Source**: [collect 001 research.md R3](../../collect/001-event-day-collection/research.md)、[029 contracts/platform-entry.md](../029-threads-pattern1/contracts/platform-entry.md)（共通の入口の関数・登録）、[specs/019-feature-switches](../../019-feature-switches/spec.md)（機能のON/OFF）、[specs/028-meguru-shell](../../028-meguru-shell/spec.md)（アプリの一覧・`/api/me`の`apps`）、[docs/parallel-development.md](../../../docs/parallel-development.md) 5章。

## Clarifications

### Session 2026-11-13（夜。ユーザーが寝ている間に、Claudeが決めた。朝にユーザーが確かめる）

- collect 001 research.md R3 は「機能のON/OFF（019）に、既定でOFFの項目『集金管理』を足す」と書いた。029 のあと、機能のON/OFFは**Threadsだけが持つ仕組み**になった（`registerAppFeatures(…, { switches: true })` は1つのアプリだけ。DBの機能の表の値もThreadsの3つ）。ここに集金管理を足すと、Threadsの機能の一覧に別のアプリが混ざる。→ **機能のON/OFFとは別に、共通に「アプリの利用の許可」を作る**。アプリは、登録のときに「だれでも使える」か「運営者が開いた人だけ」かを決める。Threadsは「だれでも使える」のまま（何も変わらない）。
- 許可は、人ごと・テストのグループごとに開ける（どちらかで開いていれば使える）。閉じたグループの許可は効かない（機能のON/OFFと同じ）。運営者は、許可がなくても、すべてのアプリを使える（試すため）。
- 料金・利用の数は扱わない（001は無料。料金を数えるのは、そのアプリの仕様で決める）。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 運営者が、テストの人に集金管理を開く（Priority: P1）

運営者は、運営の画面で、テストの人（メールアドレスで探す）か、テストのグループに、「運営者が開いた人だけ」のアプリ（集金管理など）を開く・閉じる。

**Why this priority**：これがないと、集金管理を、だれにも使ってもらえない（だれでも使える形で出すしかなくなる）。

**Independent Test**：「運営者が開いた人だけ」のアプリを1つ登録し、運営者が人Aに開く → 人Aの`/api/me`の`available`にそのアプリが出る。人Bには出ない。グループGに開くと、Gの人には出る。Gを閉じると出なくなる。

**Acceptance Scenarios**：

1. **Given** 「運営者が開いた人だけ」のアプリ X、**When** 運営者が人Aに X を開く、**Then** 人Aの`available`に X が入り、人Aは X の道筋を使える。ほかの人は使えない（APIは403 `APP_NOT_AVAILABLE`）。
2. **Given** 人Aに X を開いている、**When** 運営者が閉じる、**Then** 人Aの`available`から X が消え、X の道筋は403になる（Xのデータは消さない。もう一度開けば戻る）。
3. **Given** テストのグループGに X を開いている、**When** Gの人が`/api/me`を読む、**Then** X が入る。**When** Gを閉じる、**Then** 入らない（人ごとに開いていれば入る）。
4. **Given** 運営者、**When** `/api/me`を読む、**Then** 許可がなくても X が入る。
5. **Given** 開いた・閉じた、**Then** 運営の記録（だれが・いつ・だれに）に残る。

### User Story 2 - 許可のない人には、アプリが見えない（Priority: P1）

許可のない人には、すべてのアプリの画面・アプリの切り替え・入口の行き先に、そのアプリが出ない。最後に使ったアプリとして選ぶこともできない。

**Independent Test**：許可のない人の`available`に X がない。`PUT /api/me/last-app`で X を送ると400。許可を閉じたあと、`last`が X の人は`last`が null になる。

**Acceptance Scenarios**：

1. **Given** 許可のない人、**When** `PUT /api/me/last-app` に X、**Then** 400（`VALIDATION_FAILED`）。
2. **Given** `last_app_id` が X の人の許可を閉じた、**When** `/api/me`、**Then** `last` は null、`landing` は X 以外。
3. **Given** Threadsだけを使う人、**Then** `/api/me`の応答と画面は今と同じ。

### Edge Cases

- 登録していないアプリの名前で許可を開こうとした → 400（`VALIDATION_FAILED`）。「だれでも使える」アプリの許可を開こうとした → 400（意味がないため）。
- 退会した人：許可の行は、人の行と一緒に消える。
- 許可を閉じても、そのアプリのデータは消さない（001はテスト版。消すのはアプリの退会・データ削除の決まりで）。
- アプリの一覧（`APP_CATALOG`）で`released: false`のアプリは、許可があっても`available`に出さない（今と同じ）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**：アプリは、組み立てのときに、利用の決まりを「だれでも使える（open）」か「運営者が開いた人だけ（granted）」で登録できる。登録しないアプリは「だれでも使える」。
- **FR-002**：共通は、人ごと・テストのグループごとの許可を持つ。「運営者が開いた人だけ」のアプリは、運営者、人ごとの許可がある人、閉じていないテストのグループの許可がある人だけが使える。
- **FR-003**：共通の入口の関数（`loadAppEntitlement`・`loadAppEntitlements`）は、使えない人には`access: "none"`を返す。アプリの道筋を使えるかの関所（`requireAppAccess(app)`）を共通が出し、使えない人は403 `APP_NOT_AVAILABLE`。
- **FR-004**：`/api/me`の`apps.available`は、出してよいアプリ（`released`）のうち、その人が使えるものだけ。`using`・`last`・`landing`も、この一覧で絞る。`PUT /api/me/last-app`は、使えないアプリを400にする。
- **FR-005**：運営者だけのAPIで、人ごと・グループごとの許可を読む・開く・閉じる。登録していないアプリ・「だれでも使える」アプリは400。開いた・閉じたことを運営の記録に残す。
- **FR-006**：運営の画面に、「運営者が開いた人だけ」のアプリがあるときだけ、人ごと・グループごとに開く・閉じるを出す（アプリの名前は登録の一覧から出す。外枠にアプリの名前を書かない）。そのアプリがなければ、画面は今と同じ。
- **FR-007**：Threadsは「だれでも使える」。このfeatureで、Threadsを使う人の応答・画面・判定は変わらない。

### Key Entities

- **人ごとの許可**：アプリ・人・開いた時刻・開いた運営者。
- **グループごとの許可**：アプリ・テストのグループ・開いた時刻・開いた運営者。

## Success Criteria *(mandatory)*

- **SC-001**：「運営者が開いた人だけ」のアプリを、運営者が人・グループに開いてから、その人が次に画面を開いたときに使える（待ちなし）。
- **SC-002**：許可のない人は、APIでも画面でも、そのアプリを使えない（テストで、道筋の関所・`available`・`last-app`を確かめる）。
- **SC-003**：Threadsだけの人の`/api/me`の応答が、このfeatureの前後で同じ（テストで確かめる）。

## Assumptions

- 集金管理のアプリの一覧への追加（`APP_CATALOG`に`collect`）と、集金管理の登録（`granted`）は、集金管理のPR1で行う。このfeatureは仕組みだけを入れ、テストでは仮のアプリで確かめる。
- 許可の数は少ない（テストの人は数十人）。一覧はページに分けない。
