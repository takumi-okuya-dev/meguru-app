<!--
Sync Impact Report:
Version change: N/A → 1.0.0 (initial ratification)
Modified principles: N/A (initial)
Added principles: I. 人格・トーン・NGワードの一貫性, II. 人間承認ゲート, III. 外部LLM前提・API依存ゼロ（MVPスコープ）,
  IV. プラン／ロール分離の原則, V. 個人プラン起点のシンプルさ（YAGNI）, VI. 改善フィードバックループの忠実性
Added sections: 技術スタック制約, 開発ワークフロー, Governance
Removed sections: none
Templates requiring updates: ⚠ spec-template.md / plan-template.md / tasks-template.md / checklist-template.md
  — bundled defaults, not yet reviewed against these principles (first feature spec will surface gaps)
Follow-up TODOs:
  - TODO(COMMERCIAL_LAUNCH_GATE): Meta App Reviewを通過し他者が使える本番公開・課金を開始するタイミングで、
    develop ブランチ運用を導入し、Cloudflare/Neon/Clerk/Stripeの本番・検証環境を分離すること（PRD §6.2参照）
  - TODO(OSS_LICENSE_CHECK): n8n/Postizは不採用（フルスクラッチ確定済み、Wikiノート「分岐判定」参照）。
    将来OSSコンポーネントを追加する場合はSaaS再販可否のライセンス確認を本原則に追記すること
-->

# ThreadsGrower App Constitution

## Core Principles

### I. 人格・トーン・NGワードの一貫性（NON-NEGOTIABLE）
Threadsへ実際に配信されるあらゆるコンテンツ（自動投稿・スケジュール投稿を含む）は、Account単位の
戦略プロファイル・NGワード設定によるチェックを経なければ配信されてはならない。このチェックを
バイパスできる経路を本番導線・管理者操作に残してはならない。
**Rationale**: 「人格・トーンを保ったまま継続的にThreadsを運用したい」がプロダクトの存在意義その
ものである（PRD §1 Vision）。5本柱（Five Pillars）の偏り管理もこの一貫性の一部として扱う。

### II. 人間承認ゲート（NON-NEGOTIABLE）
投稿ストック（Post Stock）上の下書きは、個別承認または一括承認という明示的な承認ステップを経ない
限りThreads APIへ自動投稿してはならない（FR-7, FR-8）。却下する場合は却下理由を必ず記録し、次回の
AIプロンプト生成に反映できる形で保持する。
**Rationale**: 「投稿ストック→承認→自動投稿→分析→改善」のループが製品の中核（PRD §1）。承認を
経ない自動投稿は、運用者が最も恐れるインシデント（人格を損なう投稿の無断公開）に直結する。

### III. 外部LLM前提・API依存ゼロ（MVPスコープ）
MVPスコープでは投稿本文の生成をアプリ内部で行わない。アプリが担うのは戦略プロファイルを反映した
AIプロンプトの自動生成（FR-4）までとし、本文生成は外部LLM（ChatGPT/Claude等）へのコピペ運用に
委ねる。内部LLM API呼び出しを追加する場合は、PRD §5 Non-Goalsからの明示的なスコープ変更として
本Constitutionを改定してから着手する。
**Rationale**: API費用ゼロ・LLM選択自由という設計判断がPRD §5・Product Briefに明記されている。
参考プロダクト（Threads Growth OS）も同じ思想を採る。

### IV. プラン／ロール分離の原則
`Account.plan`（契約単位・4段階の機能ゲート）と`Membership.role`（プラン4限定・owner/memberの
ユーザー単位ロール）は、常に分離した別概念として実装する。単一プロパティへの統合（「プラン＝
ロール」）は行わない。`member`ロールを持てるのは`plan = team`（プラン4）のAccountに紐づく
Membershipのみとする。
**Rationale**: 2026-10-01、「プラン＝ロール」の単一プロパティ案は、契約（Account単位・1つ）と
権限（User単位・複数になりうる）のカーディナリティが異なるために不採用と確定した経緯がある
（PRD §3 Glossary、Wikiノート「Threads自動投稿アプリ.md」参照）。実装時にこの分離を崩すと、
同じ設計上の矛盾を再発させる。

### V. 個人プラン起点のシンプルさ（YAGNI）
プラン4（チーム管理：招待リンク・Membership.role管理・クロスアカウント匿名ベンチマーク・監査ログ・
アカウント単位PIN・二段階承認）は、プラン1〜3のコア機能一式（FR-1〜FR-12のうちプラン4関連を除く
もの）が実装・検証されるまで着手しない（PRD §6.2）。
**Rationale**: 実需ヒアリング未実施の段階でチーム機能まで作り込むと、単一ユーザー運用での価値
検証サイクルが遅れる。PRD §8 Open Question 1（実需ヒアリング）の結果を待つべき領域。

### VI. 改善フィードバックループの忠実性
パフォーマンス分析（FR-9）で低調と判定された投稿、および却下ログ（FR-7）は、Account単位の改善
フィードバックとして保存し、次回のAIプロンプト生成（FR-4）に必ず反映されなければならない。この
経路を実装せずにFR-9だけを満たした状態（分析結果が表示されるだけで次の生成に活きない）を「完了」
としてはならない。
**Rationale**: 「このパターンは伸びていない」という判断が自動的に次のプロンプトに反映される
瞬間がUJ-3のクライマックスであり（PRD §2.3）、これが欠けると分析機能が片手落ちになる。

## 技術スタック制約

- **確定方針**：フルスクラッチで構築する。既存ツール（n8n：fair-code licenseでSaaS再販に制約、
  Postiz：AGPL-3.0でソース開示義務）は採用しない（Wikiノート「分岐判定」参照）。
- フロントエンド：React + TypeScript（Vite製SPA）。Cloudflare Pagesでホスティングする。
- バックエンド：Cloudflare Workers + Hono（TypeScript）。別のバックエンドサービス（NestJS等）は
  MVPでは導入しない。
- データベース：Neon（Postgres）+ Drizzle ORM。
- 認証・マルチテナント：Clerk。Organizations機能はプラン4（チーム管理）契約時のみ使用し、プラン
  1〜3はClerk Userのみで完結させる（原則IV・無料枠消費の抑制、PRD addendum参照）。
- 決済：Stripe（Billing + Checkout）。
- スケジューラ：Cloudflare Cron Triggers を基本とし、必要に応じて Upstash QStash を追加する。
  **既知のリスク**：高頻度ポーリング（例：1分間隔）はNeon無料枠（100 CU-hours/月）を超過しうる
  ため、実装時にポーリング間隔またはキャッシュ戦略を再検討すること（PRD §8 Open Question 5）。
- UI：shadcn/ui（Radix UI + Tailwind CSS）。ChatGPT風のニュートラルな質感（グレー/白基調、左
  サイドバー＋右メインパネル、ダークモード対応）を踏襲する。
- **運用コスト制約**：月額固定のインフラ費用は$0からの運用を目標とする（Cloudflare Workers
  Free / Neon Free / Clerk Freeの前提を崩さない設計を優先する）。決済手数料は売上連動の変動費
  として別枠で扱う。
- 実装言語はTypeScriptで統一する（フロントエンド・バックエンドとも）。

## 開発ワークフロー

- 機能追加はspec-kitのワークフロー（`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-implement`）に従う。
- MVPスコープ（PRD §6.1）とOut of Scope（PRD §6.2）の境界を変更する場合は、まずPRDを更新して
  から実装に進む。
- BMAD-METHODは計画フェーズ（Product Brief・PRD）で使用済み。実装フェーズではspec-kitのみを
  用い、両者を並行稼働させない。
- **ブランチ運用**：検証段階（TODO(COMMERCIAL_LAUNCH_GATE)発火前）は`main`＋`feature/*`のみで
  運用する。SaaSとして外部公開・課金を開始するタイミングで`develop`ブランチを導入し、`main`
  （公開用）／`develop`（テスト運用）／`feature/*`（追加実装）の3段構成に切り替える。

## Governance

- 本Constitutionは、PRD・Product Brief・個別feature specより優先する。矛盾がある場合は本書を
  正とし、矛盾元のドキュメント側を修正する。
- 改定はセマンティックバージョニングに従う：原則の削除・後方非互換な再定義＝MAJOR、原則の追加・
  実質的な拡張＝MINOR、文言修正・明確化＝PATCH。
- 改定時は`/speckit-constitution`を再実行し、Sync Impact Reportを都度残す。

**Version**: 1.0.0 | **Ratified**: 2026-10-01 | **Last Amended**: 2026-10-01
