# 日本の近い競合と利用者の声 — round 2

調査日: 2026-11-12。予算（ツール呼び出し18回）を使い切った時点でまとめた。検索結果の要約は検索エンジン側の要約で、原文ではない。そのため、本文を取得できなかった情報源は confidence を一段下げている。

## Findings

### GLOOK
- claim: GLOOK（GLOOK株式会社）は、ビジネスパーソン向けにリアル・オンラインのイベントを載せる無料アプリ。売りは「イベント後も参加者同士がプロフィールでつながれる」点で、参加者のプロフィールを見て後から連絡できる、同じイベントの参加者だけが見られる募集機能がある、勧誘・営業目的の人を参加データから事前に検知する、と説明している。いずれも App Store 掲載文を検索エンジンが要約したもので、本文は取得できていない | source: GLOOK - あとからも繋がれるイベントアプリ（App Store、検索結果経由） https://apps.apple.com/jp/app/id6475799878 | publisher: GLOOK株式会社（App Store掲載） | pub_date: unknown | accessed: 2026-11-12 | confidence: low | class: feature
- claim: 検索結果のスニペットでは App Store 評価が 4.4、件数は10件。利用規模はかなり小さいとみられる | source: 同上 | publisher: Apple App Store（スニペット） | pub_date: unknown | accessed: 2026-11-12 | confidence: low | class: traction
- claim: 2026-11-12 に WebFetch で App Store の JP ページを取得したところ HTTP 404 だった。同じ方法でつなげーとのページは取得できたので、配信停止またはJPストアからの取り下げの可能性がある（ただし未確定）。公式サイトや報道記事も検索では見つからなかった | source: https://apps.apple.com/jp/app/id6475799878（404） | publisher: Apple | pub_date: n/a | accessed: 2026-11-12 | confidence: low | class: trajectory
- 未確認: 出会った人の個人的な記録（写真・メモ）や、複数イベントをまたぐ記録の有無。「イベント単位の参加者プロフィールで後から連絡」という作りで、自分用の人物メモではないとみられるが、根拠は掲載文の要約のみ。

### Koino
- claim: Koino（COMINAL, K.K.）は、コワーキングスペースやイベント向けのビジネスマッチングアプリ。会場・イベントの QR を読むとチェックインし、チェックイン中の参加者を見られ、AI が共通の関心からマッチングを提案する | source: Koino（App Store、検索結果経由） https://apps.apple.com/jp/app/koino/id6743766215 | publisher: COMINAL, K.K.（App Store掲載） | pub_date: unknown（アプリIDの番号帯から2025年頃の公開と推測。未確認） | accessed: 2026-11-12 | confidence: low | class: feature
- claim: 2026-11-12 の WebFetch では App Store JP ページが 404。料金・評価件数・最終更新日は取得できなかった | source: 同上（404） | publisher: Apple | pub_date: n/a | accessed: 2026-11-12 | confidence: low | class: trajectory

### つなげーと（TunaGate.Inc）— 稼働を確認
- claim: 趣味友向けのイベントアプリ（飲み会、カフェ会、ボードゲーム、フットサルなど）。利用者自身が主催者になれる。恋愛マッチングではないと明記している | source: つなげーと - 趣味友が見つかるイベントアプリ https://apps.apple.com/jp/app/id1102122107 | publisher: TunaGate.Inc（App Store） | pub_date: 最新版 6.58.8「11月3日」（年の表示なし。2025年の可能性もあるが、文脈から2026年とみられる） | accessed: 2026-11-12 | confidence: medium | class: feature
- claim: イベント後は「友達」機能でつながる。開発者の返信によると、双方が同意しないと友達にならず、いつでも解除できる。更新履歴には「イベント後にまた会いたい人と会いやすく」する改修、参加者同士がつながる画面の改修がある。出会った人のメモ・写真を残す機能の記載はない | source: 同上 | publisher: TunaGate.Inc | pub_date: 同上 | accessed: 2026-11-12 | confidence: medium | class: feature
- claim: 本体は無料。口コミによると「VIP」会員になるとイベント参加ごとのつなげーと利用料（500円）が無料になり、参加費は主催者（イベントクリエイター）に支払う。課金するのは参加者側 | source: 同上（レビュー・開発者返信） | publisher: App Store ユーザーレビュー | pub_date: unknown | accessed: 2026-11-12 | confidence: medium | class: pricing
- claim: 評価は1,774件・平均4.2で、18+。口コミには「本名表示」「通知」「フォローの仕組み」への不満がある（イベント後のつながりの距離感やプライバシーへの不満） | source: 同上 | publisher: App Store | pub_date: unknown | accessed: 2026-11-12 | confidence: medium | class: traction / sentiment

### リベシティ名札QR
- claim: リベシティにはアプリ内の機能として「アイコン＋名前＋QRコード入りの名札」をその場で自動で作り、PNG で保存できるものがある（会員記事による説明）。QR を読むと相手の「プロフィール画面に飛んでもらえる」。自分のプロフィールの QR の横に読み取り機能があり、オフ会で相手の名札を読むのに使われている | source: リベシティ図書館の会員記事（ぷでぃま、2026/05/13投稿・2026/07/17更新） https://library.libecity.com/articles/01KRG55HD2VTMDFEV15PBQBWPG | publisher: リベシティ会員（公式ではない） | pub_date: 2026-05-13 | accessed: 2026-11-12 | confidence: medium | class: feature
- claim: 会員がコンビニのはがき印刷→ラミネート→ストラップで名札を自作する、Canva でアイコンと QR を一体にして大きく見せる、といった工夫記事が複数ある。オフ会で名札QRを使う慣習が会員の間に根付いていることがうかがえる | source: library.libecity.com の複数記事（検索結果） 例 https://library.libecity.com/articles/01K9A17GS5XY6TX5VG99QF6X9K | publisher: リベシティ会員 | pub_date: 2024〜2026（記事IDから推定） | accessed: 2026-11-12 | confidence: medium | class: behavior
- claim: 取得した記事の範囲では、オフ会で会った人を記録するメモ機能・出会った履歴は説明されていない（QR はプロフィールへ移るだけ） | source: 同上 2026/05/13 記事 | publisher: リベシティ会員 | pub_date: 2026-05-13 | accessed: 2026-11-12 | confidence: low（記事に書かれていないだけで、機能がないとは言い切れない） | class: feature

### Eight（Sansan）
- claim: Eight プレミアムは月600円・年6,000円（税込）とされる。ただし出典は比較サイト2件で、公式ページは確認できていない | source: アイミツSaaS https://saas.imitsu.jp/cate-business-card/service/3816/price ／ ITreview https://www.itreview.jp/products/eight/price | publisher: 比較サイト（格下げ） | pub_date: unknown（ITreviewは「2026 Summer」表記） | accessed: 2026-11-12 | confidence: low | class: pricing
- claim: 比較サイトはプレミアム限定機能として「名刺データのダウンロード、お礼メール、画像メモ機能、連絡先アプリとの連携」を挙げている。無料版も名刺枚数は無制限とされる | source: 同上 | publisher: 比較サイト | pub_date: unknown | accessed: 2026-11-12 | confidence: low | class: feature
- claim: 名刺ごとに自由記述のメモ欄があり、会った場所・日時・経歴などを書ける（2014年の記事なので現行仕様かは未確認） | source: lifehacker.jp 140523rakuten_eight https://www.lifehacker.jp/article/140523rakuten_eight/ | publisher: ライフハッカー・ジャパン | pub_date: 2014-05 | accessed: 2026-11-12 | confidence: low | class: feature
- 未確認: 公式ヘルプ（8card.net）の記述、受け取った側がタグ付けできるか、本人の顔写真を付けられるか。前提が名刺なので、名刺を交換しない場面では入口がない、という点は推論（証拠なし）。

### connpass / Doorkeeper
- claim: connpass は（2026年かは未確認の）2月4日にサブイベント機能を追加した。本イベントの参加登録者だけに懇親会やスプリントなどの別イベントを公開でき、本イベントの画面からサブイベントの参加状況を確認できる | source: CodeZine（検索結果） https://codezine.jp/news/detail/27671 | publisher: 翔泳社 CodeZine | pub_date: unknown（2月4日付） | accessed: 2026-11-12 | confidence: low | class: feature
- 見つからなかった: connpass・Doorkeeper の公式ヘルプで「過去の参加者へのメッセージ」「人ごとの参加履歴」「絞り込み」を確認すること（下記参照）。

### 利用者の声・行動（LINE）
- claim: ID や QR で LINE の友だちを追加すると、相手が自分で決めたアカウント名で表示される。そのため合コンや異業種交流会で大勢と交換すると、本名でない人が「後から誰だかわからなく」なる。対策として「表示名の変更」と、相手ごとのトーク背景に相手の写真を設定する、が紹介されている | source: All About「合コンで大活躍!? LINEを一斉に交換する時の裏ワザ」 https://allabout.co.jp/gm/gc/458643/ | publisher: All About（原 久鷹） | pub_date: 2015-09-23 | accessed: 2026-11-12 | confidence: medium（課題は昔から変わらないが、2年の鮮度基準は満たさない） | class: behavior
- claim: 表示名の変更は相手に通知されず、自分の画面にだけ反映される。入力は20文字まで。所属や交流会名を名前に足して見分けるのが推奨されている | source: appllio「LINE 友だちの名前変更」 https://appllio.com/line-friends-name-change （検索結果の要約） | publisher: アプリオ | pub_date: unknown | accessed: 2026-11-12 | confidence: low（LINE公式ヘルプでは確認していない） | class: behavior
- claim: 「顔や会話は覚えているのに、名前だけ抜け落ちる」「顔は頭に浮かんでいるのに、相手の名前が出てこない」といった解説記事が多い。名前・顔・文脈が結びつかないことはよく知られた悩みになっている | source: 東洋経済オンライン https://toyokeizai.net/articles/-/677583 ／ PRESIDENT Online https://president.jp/articles/-/99791 （どちらも検索結果のスニペット） | publisher: 東洋経済／プレジデント社 | pub_date: unknown（2023〜2025頃と推定） | accessed: 2026-11-12 | confidence: low | class: sentiment
- claim: 過去には Wantedly「Sync」が「どこで会ったか・所属をメモして後から検索できる」サービスとして紹介されていた（2015年）。現在のサービス状況は未確認 | source: lifehacker.jp 150427wantedly_sync https://www.lifehacker.jp/article/150427wantedly_sync/ | publisher: ライフハッカー・ジャパン | pub_date: 2015-04 | accessed: 2026-11-12 | confidence: low | class: trajectory

## Leads worth chasing
- GLOOK・Koino の App Store 404 が配信停止なのかリージョン・取得側の問題なのか。Google Play の掲載と最終更新日、GLOOK株式会社の法人登記・PR TIMES を確認したい。
- 検索結果に出てきた itimai（「1秒でSNSを交換」、App Store id6443797053）と PocketQR（id6478785992）。SNS交換QR系の近い競合で、記録・メモ機能と稼働状況は未確認。
- リベシティ図書館の別記事 https://library.libecity.com/articles/01M1DD1MVGQRCGVW5NBKV00RNS （LINE表示名の検索で出てきた。オフ会で出会った人をどう管理するかの記事かもしれない）。
- 個人の運用例（スプレッドシートや Notion で人物を管理）を集めたい。note.com 内の検索（「交流会 名刺なし 管理」「人脈 Notion テンプレ」）や X の投稿は、今回の汎用検索では出てこなかった。
- LINE公式ヘルプ（help.line.me）の「表示名の変更」と、友だちに残せるメモ機能の有無。
- connpass のサブイベント機能の日付（CodeZine 記事本文）。

## Looked for but could not find
- connpass・Doorkeeper の公式ヘルプで、主催者が過去の参加者・グループメンバーへ一斉にメッセージを送れるか、人ごとの参加履歴を見られるか、絞り込めるか。今回の検索ではどちらも該当ページに当たらなかった（Doorkeeper の検索結果は無関係な他社製品ばかり）。
- Eight の公式ヘルプ（8card.net）と公式の料金ページ。タグ・本人写真・出会った場所の項目の有無。
- TOIRO・Summit! という名前の日本の交流会QRサービス。予算の都合で検索しなかった。
- 2025〜2026年の利用者自身の投稿（note、X、Yahoo!知恵袋）で「交流会後に誰か分からない」「LINE友だちが誰か分からない」と書いたもの。検索結果は編集記事やハウツー記事ばかりで、日付付きの原文を引用できるものは見つからなかった。
- GLOOK・Koino・リベシティ名札QR の利用者数や売上などの数字。
