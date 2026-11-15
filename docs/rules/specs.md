# 仕様と名前の決まり（仕様のフォルダ・番号・ブランチ・コミット）

**対象**：spec-kitで機能を作るすべての人とAI。入口は[CLAUDE.md](../../CLAUDE.md)。スキルを使う順番は[AIスキルの共用](../ai-skills.md)。

## 1. 仕様の役目

- 仕様（`specs/<アプリ>/NNN-…/`の`spec.md`・`plan.md`・`tasks.md`と、必要なら`research.md`・`data-model.md`・`contracts/`・`quickstart.md`）は、**その変更で何をなぜ作るか**の依頼書。
- `develop`に入ったあとは、そのときの記録として残し、**書き換えない**。直すのは`spec.md`の`Status`（入った日と、残りの確かめ）と、`tasks.md`の印だけ。あとで変えたくなったら、新しい仕様を作る。
- **今のシステムがどうなっているか**は、コードと「今の形」の文書（[技術ドキュメント](../architecture.md)・[モジュール地図](../module-map.md)・アプリの地図`docs/apps/<アプリ>.md`・[UI全体設計](../ui-design.md)など。一覧は[docs/README.md](../README.md)）が正本。コードを変えたPRで、同じPRのうちに直す。
- 仕様の中で決まりを作らない。セッションをまたいで守る決まりができたら、この`docs/rules/`に書く。

## 2. フォルダと番号

アプリを並行して作れるよう、仕様のフォルダと番号はアプリごとに分ける（[Constitution](../../.specify/memory/constitution.md)「開発ワークフロー」）。

- 新しい仕様は`specs/<アプリ>/NNN-<短い名前>/`に置く。`<アプリ>`はアプリのID（`@meguru/shared`の`APP_CATALOG`の`id`。`threads`・`people`・`collect`）。
- 外枠や共通（`platform/`・Webの外枠・`@meguru/shared`の共通の部分・CI・開発の決まりなど、どのアプリにも属さないもの）は`meguru`。共通とアプリの両方を変えるときは、主に変える方に置く。迷ったら`meguru`。
- 番号はフォルダごとに振る。`threads`と`meguru`は`029`から（`specs/028`までの続き）、新しいアプリは`001`から。
- 番号は、ブランチを切る前に、`develop`と作業中のブランチの`specs/<アプリ>/`の最大の番号を確かめ、その次を使う。アプリをまたいで並行するときは、ぶつからない。同じアプリで2つを同時に進めるときだけ気をつける。
- `specs/001`〜`specs/028`は動かさない（コードのコメントや文書から参照しているため）。`specs/`の直下には新しい仕様を作らない。
- `/speckit-specify`では、出し先（`SPECIFY_FEATURE_DIRECTORY=specs/<アプリ>/NNN-<短い名前>`）を毎回はっきり指定する。spec-kitの自動の番号は`specs/`の直下しか見ないため。スキルの本文（`.claude/skills/speckit-specify/SKILL.md`）にも、この決まりを書いてある。

## 3. ブランチとコミットの名前

- ブランチは`feature/<アプリ>-NNN-<短い名前>`（1つの仕様を何回かのPRに分けるときは`feature/<アプリ>-NNN-pr2-…`のように足す）。仕様のない直しは`fix/<アプリ>-…`、文書だけは`docs/…`。
- コミットの頭は`feat(<アプリ>-NNN)`・`fix(<アプリ>)`・`docs(<アプリ>)`・`test(…)`・`refactor(…)`のように、種類とアプリの名前（と番号）で呼ぶ（例：`feat(people-001)`、`fix(collect)`）。
- コミットの本文とPRは日本語で書く。

## 4. この文書の更新

- 決まりを変えたら、同じPRでこの文書を直す。
