# 反応数の取り込みの手順（定期処理）

**対象feature**：[spec.md](../spec.md) FR-001〜FR-010 ／ **調査**：[research.md](../research.md) R2〜R5・R10・R11 ／ **005の手順**：[auto-post-job.md](../../005-auto-post/contracts/auto-post-job.md)

005の`runAutoPost`（5分ごと、KVの関所で用のある回だけDBを使う）の最後に、「反応数の段階」を足す。日次のCron（`0 18 * * *`）の処理は変えない。

## 005の手順への差し込み

```text
0. 関所（005）：KV の autopost:gate・autopost:wake に加え、metrics:catchup も読む
1. 続きの処理（005）
2. 時刻の処理（005）
5. 投稿のURLの取り直し（005）
6. ★ 反応数の段階（本feature）
7. 関所の書き込み（005）：候補に「次の日本時間3:00」を足す（その日の補いが済んでいなければ、今日の3:00）。
   反応数の段階に残りがあれば immediate（次の回にすぐ続ける）
```

関所が閉じていれば、反応数の段階も行わない（DBを起こさない）。

## 6. 反応数の段階

### 6-0. 使える回数

`calls = METRICS_MAX_CALLS_PER_TICK − 8 × (この回に進めた公開の試みの数)`。0以下なら何もせず、残りがあることにして終える（research.md R3）。

### 6-1. 対象を読む（DBに1回）

次の条件の投稿済みの下書きを、`post_metrics`・Account・接続・トークン・grower機能の判定の材料（Accountの`plan`と持ち主の登録日時）と結合して読む（上限は`calls`＋余裕）。

- Accountが`connected`で、grower機能を使える（`hasGrowerAccess`）。`insights_denied_at`が今日（日本時間）でない。
- `post_metrics`の`state`が`confirmed`・`late_confirmed`・`unmeasurable`でない。
- 次のどれかに当たる：
  - **(a) 時点**：経過が `[23h, 25h]`・`[71h, 73h]`・`[167h, 169h]` のどれかで、その時点の履歴がない
  - **(b) 補い**（その日の補いが始まっていて、まだ終わっていないときだけ）：経過がある時点＋1時間を過ぎていて、その時点もそれより後の時点も履歴がない
  - **(c) 計測できない**（補いのときだけ）：`threads_media_id`がない

並び：(a)を先（幅を過ぎると取れないため）、次に(c)、最後に(b)を投稿の古い順。

### 6-2. 何を取るかを決める

| 経過 | 取る種類 | 取り方 |
|---|---|---|
| 23〜25時間（(a)） | `h24` | `slot` |
| 71〜73時間（(a)） | `d3` | `slot` |
| 167〜169時間（(a)） | `d7` | `slot` |
| (b)で、過ぎた時点のうち最も新しいものが`h24`・`d3` | その時点 | `daily` |
| (b)で、168時間を過ぎ、192時間以内 | `d7` | `daily` |
| (b)で、192時間を過ぎている | `late` | `daily` |
| (c) | 呼び出さない。`unmeasurable`（`no_media_id`） | — |

### 6-3. Threadsに問い合わせる

- Accountごとにトークンを1回だけ復号する。
- `getMediaInsights`を1件ずつ呼ぶ（1回で6つの指標）。`calls`を1ずつ減らし、0になったら止める。
- 失敗の扱い（research.md R11）：

| 失敗 | その投稿 | そのAccount | この回 |
|---|---|---|---|
| `ThreadsNotFoundError` | `unmeasurable`（`not_found`）。それまでの値と履歴は残す | 続ける | 続ける |
| `ThreadsPermissionError` | 記録しない | `insights_denied_at`に今。この回のそのAccountの残りを飛ばす | 続ける |
| `ThreadsAuthError` | 記録しない | 005と同じく、世代番号を条件に要再接続にする。残りを飛ばす | 続ける |
| `ThreadsRateLimitError` | 記録しない | — | 反応数の段階を止める（残りあり） |
| `ThreadsTransientError`・そのほか | 記録しない（(a)の幅の中なら次の回、過ぎたら3:00の補い） | 続ける | 続ける |

### 6-4. フォロワー数（補いのときだけ）

その日（日本時間）の`follower_snapshots`がなく、直近30日に投稿済みのあるAccount（6-1と同じ条件）について、`getFollowersCount`を呼ぶ。`calls`が残っている間だけ。

### 6-5. 書き込む（DBに1回、`db.batch`）

1. `post_metric_snapshots`に追加（`ON CONFLICT (draft_id, kind) DO NOTHING`）。
2. `post_metrics`をupsert：
   - `h24`・`d3` → `updating`
   - `d7`（経過192時間以内）→ `confirmed`（`confirmed_at`に今）
   - `late`、または経過192時間超の`d7` → `late_confirmed`
   - 計測できない → `unmeasurable`
   - 6つの数・`last_fetched_at`・`last_elapsed_minutes`・`last_kind`を入れる（`unmeasurable`に変えるときは数を変えない）
   - 確定・計測できないの行は変えない条件を付ける
3. `follower_snapshots`に追加（`ON CONFLICT DO NOTHING`）。
4. `accounts.insights_denied_at`を更新。
5. 確定した投稿のあったAccountごとに、判定のSQL（research.md R5）：

```sql
WITH base AS (
  SELECT views FROM post_metrics pm JOIN post_drafts d ON d.id = pm.draft_id
  WHERE pm.account_id = $1 AND pm.state = 'confirmed' AND pm.views IS NOT NULL
  ORDER BY d.published_at DESC LIMIT 30
), b AS (
  SELECT count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY views) AS median FROM base
)
UPDATE post_metrics pm SET
  judgment = CASE WHEN pm.views / b.median >= 2 THEN 'good'
                  WHEN pm.views / b.median <= 0.5 THEN 'poor' ELSE 'normal' END,
  judgment_ratio = pm.views / b.median, judgment_baseline = b.median, judged_at = now()
FROM b
WHERE pm.account_id = $1 AND pm.state IN ('confirmed','late_confirmed')
  AND pm.judgment IS NULL AND pm.views IS NOT NULL
  AND b.n >= 5 AND b.median > 0;
```

### 6-6. 補いの終わり

補いの対象（(b)・(c)・フォロワー数）が残っていなければ、KVの`metrics:catchup`にその日（日本時間）を書く。残っていれば、関所を immediate にする（次の回に続ける）。

## ログ

| ログ | レベル | 内容 |
|---|---|---|
| `metrics: run` | info | 取った数（種類別・取り方別）、計測できないにした数、判定した数、フォロワー数、残り |
| `metrics: deferred` | warn | (a)の時点で、使える回数が足りず次の回に回した数（Workers Paidに移す目安。research.md R3） |
| `metrics: insights denied` | warn | 権限がないAccountの数 |
| `metrics: catch-up done` | info | 補いを終えた日 |

トークン・本文・投稿のIDは出さない（001の方針）。
