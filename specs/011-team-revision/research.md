# Research：チームの見直し

**日付**：2026-10-13 | **仕様**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md)

## R1.データの持ち方

- **決定**：
  - `teams`を作り直す：`id`・`name`（1〜50文字、必須）・`admin_user_id`・招待リンク（ハッシュ・暗号化した写し・鍵の版・作り直した日時）・`created_at`・`updated_at`。
  - `team_members`（`team_id`・`user_id`・`role`（`team_role`：admin・member・editor）・`joined_at`）。主キーは（チーム・利用者）。部分一意索引「チームに管理者は1人」（`WHERE role = 'admin'`）。`teams.admin_user_id`は`team_members`の管理者と同じ値を持ち、同じトランザクションで書く（チームの一覧を1回で引くため）。
  - `team_accounts`（`team_id`・`account_id`・`shared`（真偽、既定false）・`added_at`）。主キーは（チーム・アカウント）。一意索引`team_accounts_one_team_per_account`（`account_id`）で「1アカウント1チーム」を守る（複数に広げるときはこの索引を外す。Clarifications）。
  - 担当は、008と同じく`memberships`の`editor`の行（`team_id`つき）で持つ。管理者が自分を担当にしたときも`editor`の行にする（`authorizeAccount`が1回の問い合わせで担当を見分けられるように）。
- **理由**：判定（`authorizeAccount`）が使う`memberships`の形を保つと、001〜010の判定とテストの多くがそのまま使える。チームのロールは「人とチーム」の関係なので、アカウントごとの`memberships`には持たず、`team_members`に分ける（Constitution原則IV）。
- **検討した案**：`memberships`に`team_member`の行を足して見せてもらっている人も表す → 見せる設定を変えるたびに行を作る・消す必要があり、取りこぼしの危険があるので不採用。見せてもらっている人は、問い合わせの時に`team_members`×`team_accounts.shared`で判定する（R3）。

## R2. 008のデータを消す（Clarifications：移さずに消す）

- **決定**：マイグレーション`0012_team_revision`で、`account_partners`・`account_partner_invites`・`team_editors`を消し、`memberships`から`role IN ('partner','editor')`の行を消し、古い`teams`を消して新しい形で作り直す。`activity_logs`は残す（`actor_role`の`partner`の行も残す。画面では「パートナー（008）」と出す）。`membership_role`の`partner`の値は列挙型から消せないので、使わない値として残す。
- **理由**：公開前で、開発・確認用のデータだけのはず。移す仕組みとそのテストを作らずに済む。アカウントのデータと操作の記録は1件も消さない（SC-006）。
- **確かめ方**：消す前後で、`accounts`・`post_drafts`・`strategy_designs`・`activity_logs`の件数が同じことを、マイグレーションのテストで確かめる。

## R3.判定の形（4つの関わりとread権限）

- **決定**：
  - `packages/shared/src/permissions.ts`に、関わり（Relation）`owner`・`assigned`・`shared_viewer`と、権限`read`を足す。`permissionsFor(relation, { isTeamAdmin })`：
    - `owner`：すべて（`read`・`view`・`content`・`review`・`settings`・`activity`・`owner`）
    - `assigned`：`read`・`view`・`content`（担当の人が管理者なら`activity`も）
    - `shared_viewer`：`read`だけ
  - 任せる範囲（`Delegation`）をなくし、`review`・`settings`はオーナーだけにする。
  - `authorizeAccount`の問い合わせ：`memberships`（owner・editor）にない人について、同じ問い合わせの中で「そのアカウントの`team_accounts`が`shared = true`で、その人が同じチームの`team_members`」を見る。当てはまれば`shared_viewer`。どれにも当てはまらなければ`ACCOUNT_NOT_FOUND`（存在を明かさない）。
  - 投稿ストック・戦略を読むGET（`/api/accounts/:id`・`/access`・`/strategy`・`/promotions`・`/reference-posts`・`/research-keywords`・`/post-drafts`・`/post-drafts/published`・`/post-drafts/counts`・`/team`）を`read`にする。パフォーマンス・設定・プロンプト・自動投稿・操作の記録・`/open`は`view`（以上）のまま。
- **理由**：見せてもらっている人に許すのは「投稿ストックと戦略を読む」だけ（Clarifications）。権限を1つ足して、該当するGETだけを下げれば、ほかのルートは何も変えずに拒める（Constitution原則V）。
- **管理者の範囲**：管理者は、自分のアカウント以外では、ほかのチームの人と同じ関わりになる（Clarifications）。自分を担当にしたアカウントでだけ`assigned`。操作の記録は、担当の人のうち管理者だけが見られる（spec FR-002）。

## R4.チームのAPIの判定

- **決定**：`access.ts`に`authorizeTeamMember(db, user, teamId)`（チームの人なら`{ team, member }`、でなければ`TEAM_NOT_FOUND`）と`authorizeTeamAdmin(db, user, teamId)`（管理者でなければ、チームの人なら`ROLE_FORBIDDEN`、でなければ`TEAM_NOT_FOUND`）を置き、`/api/teams/:teamId/*`のすべてがどちらかを通る。ルートの一覧から表にないチームのルートがあれば失敗するテスト（008と同じ）を作り直す。
- **理由**：008の`authorizeTeam`と同じく、チームのAPIも判定を1か所に集める。

## R5.画面の入口と状態

- **決定**：
  - `/api/me`に`teams: [{ id, name, memberCount, role }]`を足し、サイドバーの「チーム」の見出しの下に並べる（空なら出さない）。008の`partnerTeam`・`editorWaiting`は消す。
  - チームの画面`/teams/:teamId`（アプリ全体の設定と同じ、サイドバーの中の画面）。見ている人のロールで出し分ける（管理者：ロールの切り替え・招待・担当・外す、メンバー・編集者：自分のアカウントの見せる設定・抜ける）。
  - 担当の表`/teams/:teamId/assign`（管理者だけ。008の表を、チームのアカウント×編集者と管理者にする）。
  - 見せてもらっているアカウント`/teams/:teamId/accounts/:accountId`（読むだけの専用の画面。Accountの画面のサイドバーには入らない。タブ「投稿ストック」「戦略」）。担当の人は、ふつうのAccountの画面（`/accounts/:id`）で開く。
  - 「このアカウントの設定」の「運用を手伝ってもらう」の区分を「チーム」の区分に改める：入っているチーム名（チームの画面へ）、「チームに見せる」のスイッチ、このアカウントの担当の人（009のカードを改める）。チームに入っていなければ「チームに入っていません」とだけ出す（個人運用は「チームに入っていません」と「チームを作る」の1行だけ。Constitution 4.0.1原則Vの例外の1区分）。
  - 切り替えメニュー：「自分のアカウント」と「担当しているアカウント」（オーナー名つき）。
- **理由**：画面案（①〜⑥）と、サイドバーの構造を変えないこと（Clarifications）に合わせる。見せてもらっているアカウントを専用の画面にすると、読むだけであることが分かり、Accountの画面の出し分け（ボタンを隠す）を増やさずに済む。

## R6. 008の部品を消す

- **決定**：API：`routes/team.ts`（`/api/team/*`）、`account-team.ts`のパートナーの招待・任せる範囲・参加の知らせ、`invite-service.ts`のパートナーの招待と編集者の招待、`team-service.ts`の008の関数、`grower-access`のパートナーの扱い。Web：`pages/partner/*`、`TeamSection`の招待・任せる範囲・外す、`InviteLinkDialog`（チームの招待に作り直す）、`RemovePartnerDialog`、`EditorWaiting`、`PartnerJoinedNotice`、サイドバーの「パートナーとして手伝っています」「編集者として担当しています」の表示（「担当しています・オーナー：（名前）」に改める）。テスト：008のチームのテストは、011の形に作り直すか消す。
- **理由**：似た名前の古い部品を残すと、判定の取りこぼしと混乱のもとになる。

## R7.抜ける・外す・引き継ぐの手順

- **決定**：チームの行を`FOR UPDATE`で取ってから、`team_members`・`team_accounts`・`memberships`（担当）を同じトランザクションで書く。
  - 抜ける・外す：その人の`team_members`、その人の`team_accounts`、その人の担当（`memberships`の`editor`で`team_id`が同じ行）、その人のアカウントでのほかの人の担当を消す。
  - 管理者が抜ける：要求に新しい管理者（チームの人）を含めることを求め、同じトランザクションで引き継いでから抜ける。チームに管理者しかいなければ`TEAM_ADMIN_ALONE`（409）を返し、画面はチームの削除を案内する。
  - 引き継ぐ：前の管理者は、担当が1件以上あれば編集者、なければメンバーになる（担当はそのまま。spec Edge Cases）。新しい管理者のロールは`admin`。部分一意索引で管理者は1人。
  - 最後のアカウントを外す：`TEAM_LAST_ACCOUNT`（409）で止める。アカウントの削除で最後の1件がなくなったら、同じトランザクションで抜けたものとする（管理者なら、いちばん早く入った人へ引き継ぎ、誰もいなければチームを消す。spec FR-046）。
- **理由**：管理者がいないチームを、どの順番でも作らない（SC-004）。

## R8.操作の記録

- **決定**：チームの操作（参加・抜ける・外す・ロールの切り替え・担当の付け外し・引き継ぎ・見せる設定の変更・チームの名前の変更・削除）を、関わるアカウントの`activity_logs`に、008と同じく同じトランザクションで書く（チームの名前・削除はチームのすべてのアカウントに1行ずつ）。`actor_role`は、オーナー本人なら`owner`、管理者なら`admin`、編集者なら`editor`、メンバーなら`member`。記録はチームに入っているアカウントだけ書く（008の`hasTeam`を「チームに入っている」に読み替える）。
- **理由**：008の記録の仕組み（同じトランザクション・90日）をそのまま使う。

## R9.知らせ

- **決定**：(1)管理者に、新しい人が参加したら、チームの画面の上に「（名前）さんが参加しました」を1回（`team_members.joined_notice_dismissed_at`）。(2)編集者に、担当が付いたら、そのアカウントのホームに「（アカウント名）の担当になりました」を1回（`memberships.assigned_notice_dismissed_at`）。ベルは作らない。
- **理由**：spec FR-062。008の`PartnerJoinedNotice`と同じ「閉じたら出さない」形。
