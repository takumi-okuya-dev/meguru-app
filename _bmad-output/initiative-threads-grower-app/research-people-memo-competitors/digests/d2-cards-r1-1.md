# D2 名刺管理・デジタル名刺 — round 1

調査日: 2026-11-12。ツール呼び出し約18回、読んだ情報源は約10件。公式の一次情報（公式サイト、公式ヘルプ、PR TIMES、App Store）を優先し、比較サイトやアフィリエイト記事は確度を下げて扱った。

## Findings

### プレーリーカード（Prairie Card）
- claim: 個人は月額無料で、カード代だけ払う買い切り型。価格（税込）は公式デザイン3,980円、ナチュラルウッド4,480円、カスタムデザイン4,980円、ブラックメタル14,980円。法人向けの「プレーリーカード for Business」は価格が公開されていない。 | source: プレーリーカード公式トップ https://prairie.cards/ | publisher: 株式会社スタジオプレーリー | pub_date: unknown（2026-03-04付のニュースを掲載） | accessed: 2026-11-12 | confidence: high | class: pricing
- claim: NFCのカードをスマホにかざすか、QRコード・URLで渡す。受け取る側はアプリが要らず、ブラウザでプロフィールを見て、SNSのフォローや連絡先の保存をワンタップで行う。「対面で交換した相手にだけ連絡先を見せる」設定もある。 | source: 同上 https://prairie.cards/ | publisher: スタジオプレーリー | pub_date: unknown | accessed: 2026-11-12 | confidence: high | class: feature
- claim: 受け取った側が情報を残す方法は「メールを自分に送信」と「連絡先アプリに保存」の2つだけ。届くメールの件名は「連絡先メモ」で、カードの持ち主が連絡用メールを登録していれば返信で連絡できる。受け取った側がメモやタグを付ける機能の記載はない。名刺交換フォームのように、受け取った側が自分の情報を送り返す仕組みの記載もない。 | source: 読み取った側の情報保存方法（公式ヘルプ） https://docs.channel.io/prairie_manual/ja/articles/293c38c3-読み取った側の情報保存方法 | publisher: スタジオプレーリー（Channel.ioのヘルプ） | pub_date: unknown | accessed: 2026-11-12 | confidence: high（ただし、記載がないことから判断している） | class: feature
- claim: Eight・Sansan・myBridgeとつなげられ、受け取った情報はそれらの名刺管理ツールで管理する前提になっている。つまり「受け取った人の記録」は自前で持たず、他のツールに任せている。 | source: https://prairie.cards/ | publisher: スタジオプレーリー | pub_date: unknown | accessed: 2026-11-12 | confidence: medium | class: positioning
- claim: 公式の数値は「累計利用人数250万人」（トップページのバッジ）、「所属企業数10,000社突破（2025年2月時点）」、「法人導入100社突破（2026-03-04のニュース）」。ただし同じサイトのFAQでは「100万人以上」となっていて、数字が食い違っている。他の独立した情報源では確認できていない。 | source: https://prairie.cards/ | publisher: スタジオプレーリー | pub_date: 2026-03（法人の数値） | accessed: 2026-11-12 | confidence: low（会社自身の発表のみで、内部でも矛盾がある） | class: traction
- claim: 2025年10月の「TOKYO NODE OPEN LAB 2025」で、スマホをかざすと自己紹介のAR動画が流れる機能を発表した。「印象に残る自己紹介」に力を入れている。 | source: ascii.jp https://ascii.jp/elem/000/004/323/4323682/ | publisher: ASCII | pub_date: 2025-10 | accessed: 2026-11-12 | confidence: medium（検索結果の要約しか見ていない） | class: trajectory
- claim: 対象は、仕事とプライベートの両方で使う個人と、法人や団体。 | source: https://prairie.cards/ | publisher: スタジオプレーリー | pub_date: unknown | accessed: 2026-11-12 | confidence: medium | class: positioning

### Eight（Sansan）
- claim: Eightのユーザー数は450万人を突破した（2026-07-31の発表）。ここでの「ユーザー」は、自分の名刺をプロフィールに登録した認証ユーザー。2024年3月の350万人から伸びている。 | source: PR TIMES（Sansan） https://prtimes.jp/main/html/rd/p/000000860.000049627.html | publisher: Sansan株式会社 | pub_date: 2026-07-31 | accessed: 2026-11-12 | confidence: medium（会社自身の一次発表のみ。350万人の数値は検索結果の要約） | class: traction
- claim: 最近の打ち出しは、スマホだけでデジタル名刺を渡すこと、相手の昇進や転職を自動で反映すること、Eight AIエージェント（2026年5月にベータ開始。キャリアの振り返りや求人）、ビザスクと組んだスポットコンサル（2026年3月から）。名刺管理から「キャリアの基盤」へ寄せている。 | source: 同上 | publisher: Sansan | pub_date: 2026-07-31 | accessed: 2026-11-12 | confidence: high | class: trajectory
- claim: 個人向けの「Eightプレミアム」は年6,000円（月600円）とする比較サイトと、月660円・年6,600円（2025年9月時点）とするサイトがある。公式の料金ページはアクセスを拒否され（403）、確認できなかった。比較サイトの記載では、プレミアム限定の機能として画像メモ、データのダウンロード、お礼メール、連絡先アプリとの連携が挙がっている。 | source: ITreview https://www.itreview.jp/products/eight/price ／ イミツ https://saas.imitsu.jp/cate-business-card/service/3816/price | publisher: 比較サイト | pub_date: 2025-09〜2026 | accessed: 2026-11-12 | confidence: low | class: pricing
- claim: 法人向けの「Eight Team」は契約数が6,000件を超えたと報じられている。 | source: 2026-05-07付（Sansanニュースの転載） https://aeo.washinmura.jp/ai/jp-corp-sansan-com/en/news/2026-05-07-sme-business-card-management-service-eig | publisher: 転載サイト | pub_date: 2026-05-07 | accessed: 2026-11-12 | confidence: low（転載のみ） | class: traction

### myBridge
- claim: 現在の提供元はマイブリッジ株式会社（MY BRIDGE K.K.）。App Storeの最新版は2.2.33（10月30日。年の表示はないが、最近の更新と思われる）。評価は4.5（4.4万件）。無料で、登録枚数に上限なし。名刺ごとのメモ、メモも含めたキーワード検索、共有名刺帳、URLで渡せるオンライン名刺、LINE・メールでの共有ができる。タグとリマインダーは記載がない。サービス終了のお知らせは見つからなかった。 | source: App Store「myBridge - サクッと名刺管理」 https://apps.apple.com/jp/app/id1375392167 | publisher: Apple App Store | pub_date: 10-30（年は不明） | accessed: 2026-11-12 | confidence: medium | class: feature/trajectory

### Wantedly People
- claim: 終了のお知らせは見つからなかった。サードパーティのアプリ紹介サイトに「最終アップデート日 2026年7月21日」とあり、まだ保守されているとみられる。2017年に100万ユーザー・2,000万枚を発表して以降、新しい数値は見つからなかった。 | source: app-liv.jp https://app-liv.jp/4031295/ ／ THE BRIDGE https://thebridge.jp/2017/07/wantedly-people-adds-news-timeline-ad-functions | publisher: アプリ紹介サイト／THE BRIDGE | pub_date: 2026-07（更新日）／2017-07 | accessed: 2026-11-12 | confidence: low | class: trajectory

### 海外のデジタル名刺
- claim: Popl。チーム向けプラン（価格はデモの後に見積もり）に、独自のリード獲得フォーム、イベントごとのキャンペーンと見込み度を測る質問、どの会場の参加証にも使えるスキャナー、AIの音声記録が入っている。個人向けは「デジタル名刺アプリ」とだけあり、価格も機能も料金ページには書かれていない。対象は営業・イベント・マーケティングのチーム。 | source: Popl Pricing https://popl.co/pages/pricing | publisher: Popl | pub_date: unknown | accessed: 2026-11-12 | confidence: medium | class: pricing/positioning
- claim: Blinq。Free（$0）は名刺2枚、共有と連絡先作成が無制限、名刺・参加証・QR・LinkedInを読み取るスキャナー、無制限のタグ、AIメモ（直近30日）。Premiumは月$9.99（年払いで月$7.33）、Proは月$22.49（年払いで月$16.58。AIで連絡先の情報を補う機能、無制限のAIメモ、CSV出力）。Businessは名刺1枚あたり月$6.99で、イベントのリード獲得、参加証の読み取り、独自のリードフォームが付く。リード獲得は1件$9.99の従量課金。リードフォームはBusiness以上。「Fortune 500の93%で使われている」とうたう。 | source: Blinq Pricing https://blinq.me/pricing | publisher: Blinq | pub_date: unknown（2026-11時点のページ） | accessed: 2026-11-12 | confidence: high | class: pricing/feature
- claim: HiHello。「Exchange information」をオンにすると、受け取った側が自分の連絡先を送り返し、送った人のアカウントに連絡先として登録される。相手が先に入力するか、名刺を先に見せるかを選べ、同意フォームや独自の項目も作れる。最後に「HiHelloに登録しよう」というページが出る（管理者は消せる）。価格は情報源によって食い違い、公式では確認できなかった（Professional $6〜8/月、Business $6/人/月などの記載がある）。 | source: HiHello Support「Custom Contact Exchange and Consent Forms」 https://support.hihello.com/hc/en-us/articles/28136255611035-Custom-Contact-Exchange-and-Consent-Forms | publisher: HiHello | pub_date: unknown | accessed: 2026-11-12 | confidence: medium（機能）／low（価格） | class: feature

### 利用者の声・使われる場面
- claim: 2025年の調査（営業職と経営者、計1,000人）では、紙の名刺の不満の1位は「管理の煩雑さ」（51.1%）。それでも紙を使い続ける理由の1位は「慣れていて使いやすい」（63.5%）。デジタル名刺は相手の端末や環境によって使えない方法があるという指摘もある。 | source: ITmedia ビジネスオンライン https://www.itmedia.co.jp/business/spv/2501/29/news085.html | publisher: ITmedia | pub_date: 2025-01 | accessed: 2026-11-12 | confidence: medium（検索結果の要約のみで、調査の主体は確認していない） | class: sentiment
- claim: 日本には、交流会やイベントに特化した「あとからつながる」アプリが少なくとも次のようにある。GLOOK（App Storeの名前は「あとからも繋がれるイベントアプリ」。参加者のプロフィールを見て、イベント後も連絡できる）、Koino（会場のQRでチェックインしてつながるビジネスマッチング）、リベシティ（会員の名札QRを読み取る）。いずれも主催者がいる場やプラットフォームの中で完結する形で、個人が自分用に持つ人物メモではない。 | source: App Store GLOOK https://apps.apple.com/jp/app/glook-%E3%81%82%E3%81%A8%E3%81%8B%E3%82%89%E3%82%82%E7%B9%8B%E3%81%8C%E3%82%8C%E3%82%8B%E3%82%A4%E3%83%99%E3%83%B3%E3%83%88%E3%82%A2%E3%83%97%E3%83%AA/id6475799878 ／ App Store Koino https://apps.apple.com/jp/app/koino/id6743766215 ／ リベシティ https://library.libecity.com/articles/01JXAA93BM0P1AHS2EK0CCDNMJ | publisher: App Store／リベシティ | pub_date: unknown | accessed: 2026-11-12 | confidence: low（検索結果の要約のみ。個別のページは読んでいない） | class: positioning

## Comparison table

| product | 交換の仕組み | 受け取った側が記録できること | 相手が自分で登録する形があるか | 料金 | 対象 |
|---|---|---|---|---|---|
| プレーリーカード | NFCカード、QR、URL。受け取る側はアプリ不要（ブラウザ） | 自分宛てのメールか連絡先アプリに保存するだけ。メモ・タグの記載なし。Eight・Sansan・myBridgeとつなげられる | 記載なし（一方通行） | 個人は月額無料、カード3,980〜14,980円。法人は非公開 | 個人（仕事とプライベート）と法人 |
| Eight | アプリ同士でデジタル名刺を交換、紙の名刺を撮影 | 比較サイトによれば、画像メモなどはプレミアム限定。公式では確認できず | 未確認 | 無料。プレミアムは年6,000〜6,600円（低確度）。Eight Teamは月19,800円〜 | ビジネスパーソン。キャリアの基盤へ移行中 |
| myBridge | 紙の名刺を撮影、URLで渡すオンライン名刺、LINE・メールで共有 | 名刺ごとのメモ、メモも含めた検索、共有名刺帳 | 未確認 | 無料（上限なし） | ビジネス |
| Wantedly People | 紙の名刺を撮影（最大10枚を同時に読み取り） | 未確認 | 未確認 | 未確認 | ビジネス（ほとんど更新が止まっている可能性） |
| Popl | QR、NFC。チームは参加証も読み取れる | キャンペーンのタグ、見込み度を測る質問、AIの音声記録（チーム向け） | あり（独自のリードフォーム。チーム向け） | 個人向けは非公開、チームは見積もり | 営業・イベント・マーケティングのチーム |
| Blinq | QR、ウィジェット、メール、SMS、Wallet | Freeでも無制限のタグとAIメモ（直近30日）、Proで無制限 | Business以上でリードフォーム | Free／$7.33〜9.99／$16.58〜22.49／名刺1枚$4.99〜6.99（＋リード1件$9.99） | 個人の専門職から法人まで（中心はビジネス） |
| HiHello | QRなど | 送り返された情報が連絡先として入る | あり（Exchange information。同意フォームを付けられる） | 公式で確認できず（$6〜8/月という記載がある） | 個人と法人 |
| GLOOK／Koino（日本のイベント向け） | イベントやプラットフォームの中でプロフィールを見る、QRでチェックイン | 未確認 | プラットフォームへの登録が前提 | 未確認 | 交流会の参加者（主催者がいる場） |

## Leads worth chasing
- 日本の大手（プレーリーカード、Eight、myBridge）は、受け取った側の記録が弱いか、ビジネスの名刺管理に寄っている。相手が自分で登録するフォーム（双方向の交換）がはっきり確認できたのは、海外のHiHello（標準の機能）とPopl・Blinq（法人向けの有料機能）だけ。日本の個人向けで同じことができるサービスは見つかっていない。round 2で裏付けを取る価値がある。
- 相手が自分で登録する仕組みは、海外では「イベントのリード獲得」として営業チームに課金する機能になっている（Blinqは1件$9.99）。個人のコミュニティ用途で無料にすると、価値の置き方が逆になる。
- GLOOKとKoinoは「交流会の後のつながり」に直接取り組んでいる。仕組みが主催者向け（BtoB）か参加者向けか、料金、ダウンロード数をround 2で確認したい。
- プレーリーカードの累計利用者数は、トップページの250万人とFAQの100万人以上で食い違っている。
- Eightの料金ページは403で読めなかった。App Storeの掲載ページか、Sansanの公式ヘルプで確認する必要がある。
- まだ調べていない製品: CamCard、Sansanのデジタル名刺、Linq、Mobilo、V1CE、Dot、lit.linkのようなプロフィールリンク型のサービス。

## Looked for but could not find
- 星1〜3のレビューや不満（受け取った側がアプリを入れない、カードが使われなくなる、プライバシーの懸念など）は見つからなかった。App StoreのmyBridgeのページには好意的なレビューしか表示されず、日本語の「デジタル名刺 使わなくなった」系の検索でも具体的な事例は出てこなかった。
- myBridgeとWantedly Peopleの終了のお知らせ。どちらも見つからず、まだ続いていると推定している。
- Eightプレミアムの公式の料金（403で読めなかった）。
- プレーリーカードの利用者数を裏付ける、会社とは別の独立した情報源。
- 日本のサービスで、受け取った相手について「どこで会ったか」「顔写真」を記録する機能を明記したもの。
