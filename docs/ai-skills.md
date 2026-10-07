# Claude CodeとCodexでのスキル共用

このリポジトリのBMAD 30スキルとSpec Kit 10スキルは、両方のエージェントから同じファイルを読み込む。

| スキル | 実体 | Claude Codeの読み込み先 | Codexの読み込み先 |
|---|---|---|---|
| BMAD | `.agents/skills/bmad*`、`bmod-*` | `.claude/skills/`の相対シンボリックリンク | `.agents/skills/`の実体 |
| Spec Kit | `.claude/skills/speckit-*` | `.claude/skills/`の実体 | `.agents/skills/`の相対シンボリックリンク |

Spec Kitは既存のClaude用インストール先を維持する。リンクなので更新は両方に反映され、コピーの同期は不要。`agent/skills/`にあるBMADのコピーは、この共用構成の読み込み先ではない。

Codexは`.agents/skills/`とシンボリックリンクを読み込む（[公式ドキュメント](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)）。Claude Codeも`.claude/skills/`内のシンボリックリンクを読み込む（[公式ドキュメント](https://code.claude.com/docs/en/skills#where-skills-live)）。

## 呼び出し方

同じリポジトリを開き、次のように呼び出す。Codexで一覧に出ない場合は新しいセッションを開始する。自然文で「speckit-implementスキルを使って」と指定してもよい。

| 操作 | Claude Code | Codex |
|---|---|---|
| 実装 | `/speckit-implement` | `$speckit-implement` |
| 仕様との整合性を分析 | `/speckit-analyze` | `$speckit-analyze` |
| 未実装の作業をタスクに追加 | `/speckit-converge` | `$speckit-converge` |
| BMADで実装 | `/bmad-build` | `$bmad-build` |

Spec Kitの`$ARGUMENTS`がホストによって置換されない場合は、スキルとともに送った指示を引数として扱う。スキル本文に共用時の解釈を記載している。

## Claude Codeが利用制限になったとき

1. Claude Codeの実行を止め、Codexで同じ作業ディレクトリとブランチを開く。別のworktreeを使う場合は、未コミットの変更も移す必要がある。
2. 対象feature、直前の作業、判明しているテスト結果、残っている問題をCodexに伝える。会話履歴やエージェントのメモリは自動では移らない。
3. Codexに仕様・計画・タスクと実際の変更を確認させて再開する。中断時にチェックが更新されていない可能性があるため、`tasks.md`のチェックだけで完了と判断しない。

例：

```text
$speckit-implement
対象は specs/005-auto-post です。Claude Codeが利用制限で中断しました。
spec.md、plan.md、tasks.md、git statusと差分を確認し、
途中の実装とテスト結果を確かめてから残りの作業を続けてください。
```

BMADで進めている作業では、該当するチケットや計画のパスを添えて`$bmad-build`を使う。

## 更新と適用範囲

共有する追加スキルは片方に実体を置き、もう片方のスキルディレクトリに相対シンボリックリンクを作る。Spec Kitを再生成した場合は、共用のリンクと本文の`Agent compatibility`節が残っているか確認する。`.specify/integration.json`は生成ツールの既存設定を維持しており、この対応はCodex用インテグレーションの追加インストールではない。

今回の共用対象はリポジトリ内の開発スキル。各製品の組み込み・プラグインスキル、MCP接続、認証、権限設定は個別に管理される。GitHub Issueを作る`speckit-taskstoissues`など、外部ツールを使うスキルには各ホストで対応する接続が必要。
