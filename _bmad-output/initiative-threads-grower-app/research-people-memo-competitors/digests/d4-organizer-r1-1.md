# D4 主催者の声かけリスト — round 1

調査日: 2026-11-12。予算の都合で ツール呼び出し 18回以内、WebSearch の要約と公式ページの WebFetch をもとにした。WebSearch の要約は検索エンジン側の要約なので、公式ドメインのものでも原文を全部読んだわけではない。その場合は confidence を1段下げた。

## Findings

### イベントプラットフォーム（過去参加者への再案内）

- claim: Luma のカレンダーの「People」タブでは、主催者が連絡先にタグを付けてタグで絞り込める。並べ替えは「名前／参加したイベント数／チェックインしたイベント数」。人ごとの詳細は「more details」とだけ書かれていて、参加したイベントの一覧やメモ欄があるかはページから分からない。 | source: Managing Calendar Contacts https://help.luma.com/p/managing-calendar-contacts | publisher: Luma（公式ヘルプ） | pub_date: unknown | accessed: 2026-11-12 | confidence: high | class: feature
- claim: Luma の招待は「All Contacts」「Contact Tags（特定のタグ）」「Membership Tiers」から対象を選べる。送り方はメール、電話番号がひも付いていれば SMS / WhatsApp、アプリがあればプッシュ通知。招待文は1通ぶんの共通メッセージだけで、人ごとに変える仕組みやゲストごとのメモの記載はない。送った招待は再送できない。「過去の特定イベントの参加者」に絞る項目はこのページにない。 | source: Inviting and Adding Guests to Your Event https://help.luma.com/p/inviting-and-adding-guests-to-your-event | publisher: Luma（公式ヘルプ） | pub_date: unknown | accessed: 2026-11-12 | confidence: high | class: feature
- claim: Luma のメンバータグは管理者にしか見えない（観客を整理する用途）。イベントタグは訪問者向けの絞り込み用。People の CSV 書き出しでは絞り込んだ結果だけを出せる。API の people 一覧には filter_by_tags がある。 | source: Event Tags for Calendar Filtering https://help.luma.com/p/calendar-event-tags ほか（検索要約経由） | publisher: Luma（公式ヘルプ） | pub_date: unknown | accessed: 2026-11-12 | confidence: medium | class: feature
- claim: Luma Plus は年払いで月 59 US$（月払いは $69 と第三者サイトにある）。無料プランの招待・ニュースレター送信上限は週 500件、Plus は週 5,000件。管理者は無料3人、Plus 5人。Plus は有料イベントのプラットフォーム手数料が 0%。イベント数・ゲスト数の無制限、チェックイン、CSV 入出力は無料プランにもある。 | source: Luma Pricing https://luma.com/pricing（検索要約経由） | publisher: Luma（公式） | pub_date: unknown（2026-11 に表示されていたもの） | accessed: 2026-11-12 | confidence: medium | class: pricing
- claim: Peatix はグループページの「フォロワー」一覧から「メッセージ送信」で、フォロワー全員への一斉送信と、名前の横のメールマークからの個別送信ができる。メッセージ機能は主催者本人だけが使え、サブオーナーは使えない。新しいイベントの公開時と開催72時間前には、フォロワーへ自動で通知メールが届く（文面は編集できない）。タグ付けや、興味・参加履歴での絞り込みについての記載は見つからなかった。 | source: フォロワーにメッセージを送信する：主催者ヘルプ https://help-organizer.peatix.com/ja-JP/support/solutions/articles/44001821761 | publisher: Peatix（公式ヘルプ） | pub_date: unknown | accessed: 2026-11-12 | confidence: medium（検索要約経由） | class: feature
- claim: Peatix の主催者向け機能は基本無料で、比較サイトでも「無料プラン」と紹介されている。 | source: 比較記事 https://saas.imitsu.jp/cate-cate-event-management/service/6038 | publisher: アイミツ（比較サイト） | pub_date: unknown | accessed: 2026-11-12 | confidence: low | class: pricing
- claim: Eventbrite のメール機能はチケット購入者を自動で連絡先に入れ、「過去の参加者、VIP、特定の興味グループ」に分けて送れると公式ページに書かれている。料金は第三者サイトで「Pro $15〜$100/月（送信量しだい）」などとされているが、サイトごとに数字が食い違う。 | source: Event Email Marketing https://www.eventbrite.com/features/email-marketing/ ／ https://blog.anyroad.com/post/eventbrite-pricing-plans | publisher: Eventbrite（公式）／AnyRoad（第三者） | pub_date: unknown | accessed: 2026-11-12 | confidence: 機能 medium／料金 low | class: feature, pricing

### LINE 公式アカウントと拡張ツール

- claim: LINE公式アカウントの料金は、コミュニケーションプラン ¥0（月200通、追加送信なし）、ライトプラン ¥5,000（月5,000通、追加送信なし）、スタンダードプラン ¥15,000（月30,000通、追加は約¥3/通から従量）。いずれも税別。2026年10月1日に追加メッセージ料金を改定。「絞り込み配信・ステップ配信」も通数に数えられる。 | source: 料金プラン https://www.lycbiz.com/jp/service/line-official-account/plan/ | publisher: LINEヤフー（公式） | pub_date: 2026-10 以降（ページ内に改定日の記載あり） | accessed: 2026-11-12 | confidence: high | class: pricing
- claim: LINE公式アカウントのタグは、標準では「最大5個」。有料の「チャットProオプション」を付けると「最大300個」に増え、カスタムフィルターも使える。標準の絞り込み配信（属性・オーディエンス）の詳しい説明は料金ページにはない。 | source: 同上 | publisher: LINEヤフー（公式） | pub_date: 2026-10 以降 | accessed: 2026-11-12 | confidence: high | class: feature
- claim: エルメ（L Message）はフリープランなら無料。有料プランはスタンダード 10,780円、プロ 33,000円（税込か税抜かは不明）。Lステップは初期費用 3万円という記事がある。正規代理店のコンサル費用は月15〜100万円という記載もある。比較記事の多くは運用代行・コンサルの販売を兼ねている。 | source: https://www.itreview.jp/products/lstep/price ／ https://atsoho.com/blog/line-official-l-step-elme-compare ／ https://stock-sun.com/column/what_is_lstep | publisher: ITreview／比較・代行業者ブログ | pub_date: 2026-07（atsoho の記事は「2026年7月時点」としている） | accessed: 2026-11-12 | confidence: low | class: pricing
- claim: 小規模な主催者やコミュニティがイベント案内に Lステップ・エルメを使っているという一次情報（体験記・事例）は、今回は見つけられなかった。 | source: — | confidence: — | class: behavior

### コミュニティ CRM / 会員ツール

- claim: Orbit（コミュニティ CRM）は 2024年4月11日に Postman への合流を発表し、コミュニティ製品を終えた。新規ユーザー・新規ワークスペースは受け付けず、既存ユーザーには90日の猶予とデータ書き出しが案内された。 | source: Orbit is joining Postman https://orbit-website-duh.pages.dev/blog/orbit-is-joining-postman | publisher: Orbit（公式ブログのミラー） | pub_date: 2024-04-11 | accessed: 2026-11-12 | confidence: high（事実）／鮮度は古い | class: trajectory
- claim: 日本の coorum（Asobica）と commmune は、どちらも料金を公開しておらず「要問い合わせ」。coorum はスタンダード／プレミアム／エンタープライズの3段階で、カスタマーサクセスや顧客の声の分析が中心。commmune はライト〜エンタープライズの4プラン。どちらも企業が顧客コミュニティを運営するための SaaS で、個人の主催者向けではない。 | source: https://www.itreview.jp/products/coorum/price ／ https://saas.imitsu.jp/cate-customer-success-tool/service/2648/price | publisher: 比較サイト | pub_date: 2025-07（アイミツ） | accessed: 2026-11-12 | confidence: low | class: pricing, positioning

### 小さな主催者の実際（日本）

- claim: 個人主催者の note では「集客のコツは個別の声かけ」がくり返し語られている。ただし「誰に送るか」が肝で、「参加している様子が想像できる相手にだけ誘う」のがコツとされる。言い換えると、誘う相手を選ぶ作業は主催者の頭の中だけで行われている。 | source: イベント集客で悩む人は、コレを試して https://note.com/nobook/n/n51afd5b3ab58 ／ 集客の極意は"個別のお声かけ" https://note.com/lakshmi2010/n/n7a23b97492e9 ／ 初開催のイベント集客を成功させる方法 https://note.com/organizermanual/n/ne37d3297caf0 | publisher: 個人の note | pub_date: unknown | accessed: 2026-11-12 | confidence: medium（検索要約経由で、原文は読んでいない） | class: behavior
- claim: DM に頼る集客は、担当者によって結果がばらつき、手間が増え、「誘われただけの参加者」は満足度が下がりやすい、という指摘がある（コミュニティ運営会社の note）。 | source: https://note.com/comucal/n/n23cb29920954 | publisher: 株式会社コミュカル | pub_date: unknown | accessed: 2026-11-12 | confidence: medium | class: sentiment
- claim: リピーター対策として、常連一人ひとりに手紙のような個別 DM を送る、前回の参加者に次回開催を一言伝える、という施策が勧められている。一方で「満足したのに一度きりで来なくなる参加者が多かった」という主催者の反省談もある。 | source: https://note.com/yurinico/n/n632a4111ac24 ／ https://note.com/steve_t/n/n08bf35db41a7 ／ https://note.com/hado_krabbit2023/n/n321edac89aef | publisher: 個人の note | pub_date: unknown | accessed: 2026-11-12 | confidence: medium | class: behavior
- claim: 交流会の参加者管理には Googleフォームとスプレッドシートが使われている。スプレッドシート向けに、過去の履歴をもとに同じ人と重ならないよう組み分けする無料ツール「バラすくん」もある。リピーター管理を専用ツールで行っている事例は見つからなかった。 | source: https://library.libecity.com/articles/01JRQ93EV5JJDA5SC6P1W4SZ4D ほか（検索要約経由） | publisher: リベシティ（会員の投稿） | pub_date: unknown | accessed: 2026-11-12 | confidence: low | class: behavior

### 「この人を誘うと良い」を推薦するツール

- claim: AI が「誰を招待すべきか」を勧めると明言しているのは、企業向けイベント管理ツールの Splash（「who to invite to achieve the best possible event ROI」）くらいだった。Brella、Grip、Remo、Swapcard などの AI マッチングは、参加者どうしが会場で誰に会うべきかを勧めるもので、主催者が誘う相手を選ぶ用途ではない。どれも大規模な BtoB イベント向け。 | source: https://www.marketingaiinstitute.com/blog/splash-spotlight ／ https://www.grip.events/event-networking ／ https://brella.io/blog/ai-matchmaking-future-of-events | publisher: ベンダー・メディア | pub_date: unknown | accessed: 2026-11-12 | confidence: low（ベンダーの宣伝文） | class: positioning
- claim: 「会った人のメモ（興味・会話）」と「次のイベントに誘う人の推薦」を一つにまとめたツールは、日本語・英語どちらで探しても見つからなかった（不在の発見。ただし検索は2本だけ）。 | source: — | confidence: low〜medium | class: positioning

## Comparison table

| tool | 参加履歴が見えるか | 興味・タグで絞れるか | 案内の送り方(メール/LINE/DM) | 料金 | 対象規模 |
|---|---|---|---|---|---|
| Luma | 回数で並べ替えはできる（参加数・チェックイン数）。人ごとのイベント一覧は未確認 | ○（管理者だけに見えるメンバータグで招待先を選べる） | メール＋SMS/WhatsApp＋アプリ通知。LINE はなし。招待文は一斉で共通 | 無料（週500通）／Plus 年払い $59/月（週5,000通） | 小〜中規模の主催者、テック・スタートアップ系 |
| Peatix | 記載なし（フォロワー一覧は見られる） | 記載なし（全員か個別のどちらか） | メール（Peatix のメッセージ）。新規イベントは自動通知 | 基本無料（チケット手数料あり、今回は未調査） | 日本の個人〜法人主催者 |
| Eventbrite | 購入者は自動で連絡先に入る | ○（過去参加者・興味グループに分けられる） | メール | Pro $15〜100/月（第三者情報、low） | 海外の中〜大規模 |
| LINE公式アカウント | ×（イベントとは連携しない） | 標準タグは5個まで。300個はチャットPro（有料オプション） | LINE | ¥0／¥5,000／¥15,000（税別・月額） | 店舗・事業者 |
| エルメ / Lステップ | ツールの作り込みしだい | ○（タグ・セグメントが売り） | LINE | エルメ 無料〜33,000円／Lステップ 初期費用3万円〜（low） | 事業者・マーケター（代行・コンサル前提の運用が多い） |
| coorum / commmune | 会員の行動データあり（詳細は未確認） | 未確認 | プラットフォーム内 | 要問い合わせ | 企業の顧客コミュニティ（エンタープライズ） |
| Splash など BtoB AI | ○ | ○（AI が招待先を推薦） | メール | 要問い合わせ | 大企業のイベントマーケティング |
| スプレッドシート＋LINE/Instagram DM（現在の実際のやり方） | 手で管理 | 頭の中でやる | 個別 DM | 無料 | 個人の主催者 |

## Leads worth chasing

- Luma の人ごとの詳細画面に何が出るのか（参加したイベントの一覧、メモ欄があるか）。Luma は「タグで招待できる」ところまでは来ているので、いちばん近い競合になる。日本でどれくらい使われているかも確かめたい。
- Peatix のフォロワー一覧で、参加回数やタグが見られるか。管理画面のスクリーンショットや主催者ブログで確認する。
- connpass、Doorkeeper、Meetup の主催者向けメッセージ機能。今回は検索で何も取れなかったので、公式ヘルプを直接取得する。
- LINE公式の標準の「オーディエンス」機能（クリック・流入経路・チャットのタグで作れる）が、無料プランで主催者の声かけリスト代わりになるか。
- エルメやLステップをイベントの案内に使っている、小さな主催者・サークルの一次情報（X や note の体験記）。
- Splash の Attendance Insights の実際の仕様。
- 主催者が「誰を誘うか」を頭の中で決めていることを裏付ける、もっと直接的な声（X の「誰誘えばいいか」「常連 管理 大変」など）。

## Looked for but could not find

- connpass のグループメンバーへのメッセージ機能の一次情報（検索で何も出なかった）。
- Circle、Bevy、Common Room、Commsor、Mighty Networks の現在の料金・機能（予算切れで調べられなかった）。OSIRO と Liny の料金も同じ。
- エルメの公式料金ページ（lme.jp/price/ は 404）。
- Luma で「特定の過去イベントの参加者」に絞って招待する機能（招待ページに記載なし）。
- 小規模な主催者がリピーター管理に専用ツールを使っている事例（スプレッドシートと頭の中での管理しか見つからなかった）。
- 個人のメモ（会った人・興味・会話）と、次のイベントへの声かけ推薦を組み合わせたツール。日本にも海外にも見つからなかった。
