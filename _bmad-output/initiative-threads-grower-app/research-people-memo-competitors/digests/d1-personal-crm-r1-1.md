# D1 パーソナルCRM — round 1

調査日: 2026-11-12。使ったツール: WebSearch / WebFetch（17回）。ちゃんと読んだ情報源は約10件。
注意: 競合の Dex が書いたまとめ記事（getdex.com/blog）を何度も使っている。Dex 自身の話ではない部分は、利害のある第三者の情報として信頼度を下げている。

## Findings

### Dex
- claim: Dex には無料プランがない。Premium は年払いで $12/月（月払いだと $20/月）、Professional は年払いで $20/月（月払いだと $34/月）、Team は $40/月。お試しはカード登録つきの7日間。学生は50%引き。 | source: Dex Pricing https://getdex.com/pricing | publisher: Dex（公式） | pub_date: unknown（2026-11-12時点で表示されている内容） | accessed: 2026-11-12 | confidence: high | class: pricing
- claim: Dex に人が入る経路は、LinkedIn同期（ブラウザ拡張。Premiumで2,500件まで、Professionalで9,000件まで）、Gmail/Yahoo/Outlook、Google/Outlookカレンダー、Facebook、WhatsAppなどのメッセージ同期、電話の連絡先など。「15以上の取り込み元」をうたう。名刺の読み取りやQRでの交換は料金ページに載っていない。 | source: Dex Pricing https://getdex.com/pricing | publisher: Dex | pub_date: unknown | accessed: 2026-11-12 | confidence: high | class: feature
- claim: Dex で覚えておくための機能は、連絡を取るよう促すリマインダー、誕生日の通知、メモ、自分で作れる項目、最後にやり取りした内容、地図表示。AI は「Dex Research」で、相手の経歴や最近の変化をまとめる（月10〜50回分）。Professional には音声入力もある。顔写真や「どこで会ったか」は料金ページに載っていない。 | source: Dex Pricing https://getdex.com/pricing | publisher: Dex | pub_date: unknown | accessed: 2026-11-12 | confidence: medium（料金ページに書かれていないだけで、機能がないとは言い切れない） | class: feature
- claim: Dex は LinkedIn をよく使って人脈を広げたい人向け、と第三者の比較記事に書かれている。 | source: OnePageCRM "best personal CRM" https://www.onepagecrm.com/blog/best-personal-crm | publisher: OnePageCRM（競合のブログ） | pub_date: 2026（検索結果の要約から） | accessed: 2026-11-12 | confidence: low（記事本文は読んでいない） | class: positioning

### Mesh（旧 Clay）
- claim: 2026-03-26 に「Today, Clay is becoming Mesh.」と発表した。理由は「Clay」という名前が営業向けの別会社 Clay.com と紛らわしいこと。「over 170 million relationships」を管理していると書いている。自分のことを「personal AI-friendly CRM … in an open source way」と呼んでいる。ページ下部の著作権表記は「© 2026 Automattic Inc.」。 | source: Mesh story https://me.sh/stories/mesh | publisher: Mesh（公式） | pub_date: 2026-03-26 | accessed: 2026-11-12 | confidence: high | class: trajectory
- claim: Automattic が Clay を買った時期は情報によって違う。Dex の記事は本文で「2024」と書いているのに、リンク先URLの日付は 2025/06/12。発表ページには、買収のことは書かれていない。 | source: Dex "10 Best Personal CRMs…2026" https://getdex.com/blog/personal-crm-in-2020-20-startups-apps-and-failed-attempts | publisher: Dex（競合） | pub_date: 2026-07-07（最終更新） | accessed: 2026-11-12 | confidence: medium（Automattic の傘下であることは著作権表記で確かめられた。時期ははっきりしない） | class: trajectory
- claim: Mesh の料金。Personal は無料（カード登録が必要。連絡先1,000件まで。メール・カレンダー・X・LinkedIn・Facebook・iMessage から自動で取り込む。検索、グループ、Reconnect、リマインダー、誕生日、相手の近況の通知つき）。Pro は $10/月（50%引きとして表示。件数無制限、CSVの取り込み）。Team は1人 $40/月。Enterprise は個別に相談。14日間の Pro お試しがある。 | source: Mesh Pricing https://me.sh/pricing | publisher: Mesh（公式） | pub_date: unknown（著作権表記は2026） | accessed: 2026-11-12 | confidence: high | class: pricing
- claim: Mesh の料金ページには、写真・会った場所・メモ・タグの話も、名刺やQRの話も載っていない。AI は「Nexus — AI navigator for your network」というメニュー名だけ。 | source: Mesh Pricing https://me.sh/pricing | publisher: Mesh | pub_date: unknown | accessed: 2026-11-12 | confidence: medium | class: feature
- claim: App Store では 4.4★、766件。低い評価で目立つ不満は次のとおり。連絡先が重複する（「U.S. country codes create duplicate contacts」2024-03）、メモが消えた（「none of my notes for my contacts are there!」）、データが消えた（「All of my work was gone.」2024-10）、件数が多いと動作が不安定（「not sure they're up to the task of handling contacts in the hundreds」2024-04）、アカウントを消す手段がない（2022）、値段の割に機能が少ない、AI や Vision Pro にばかり力を入れて基本機能が後回し（2024-03）。 | source: App Store "Mesh: Contacts + CRM (formerly Clay)" https://apps.apple.com/us/app/id1463073824 | publisher: Apple App Store | pub_date: レビューは 2022〜2024年が中心 | accessed: 2026-11-12 | confidence: medium（12か月以内のレビューはほとんど見えなかった。2022〜2024年にかけて同じ不満が続いている、という読み方になる） | class: sentiment

### Monica
- claim: Monica は v3 を一から作り直していて、公開は「before the end of 2026」の予定。ベータは少しずつ開放する。ネイティブのiOS/Androidアプリは v3 の後。今は有料のクラウド版に新しく登録できない。自分のサーバーで動かすなら無料（オープンソース。2017年から）。 | source: Monica https://monicahq.com/ | publisher: Monica（公式） | pub_date: unknown（2026-11時点の表示） | accessed: 2026-11-12 | confidence: high | class: trajectory
- claim: Monica に人が入る経路は vCard と CSV の取り込み（重複は確認してからまとめる）。「How you met」の項目、メモや日記、連絡を促すリマインダー、人と人の関係、贈り物や貸し借りの記録がある。「not a sales CRM」とはっきり書き、友人・家族・近所の人などを覚えておきたい、プライバシーを重視する人を狙っている。写真の話は載っていない。 | source: Monica https://monicahq.com/ | publisher: Monica | pub_date: unknown | accessed: 2026-11-12 | confidence: high | class: feature/positioning
- claim: クラウド版の料金は「$9/月」とする記事があるが、公式ページには金額が載っていない。「Monica AI」という別の製品の料金と混ざっている情報が多い。 | source: Dex 記事 https://getdex.com/blog/personal-crm-in-2020-20-startups-apps-and-failed-attempts | publisher: Dex（競合） | pub_date: 2026-07-07 | accessed: 2026-11-12 | confidence: low | class: pricing

### Covve
- claim: Covve は今、展示会などで営業チームが名刺を読み取って見込み客を管理する方向に寄っている。人が入る経路は、名刺・イベントの入館証・LinkedIn の QR・デジタルの人物情報の読み取り、音声入力、デジタル名刺の交換、オフラインでも記録できること。読み取りの精度は96%、60以上の言語に対応とうたう。AI で見込み客の評価や情報の補強をする。「2M+ users in 130+ countries」と書いている。料金はページに載っておらず、14日間のお試しだけ。 | source: Covve https://covve.com/ | publisher: Covve（公式） | pub_date: unknown（2026年の ISO 27001 バッジあり） | accessed: 2026-11-12 | confidence: high（方向性について）/ low（料金について） | class: positioning/feature
- claim: Covve は 2020年にデータ漏えいを起こした。 | source: Dex 記事（上と同じ） | publisher: Dex（競合） | pub_date: 2026-07-07 | accessed: 2026-11-12 | confidence: medium | class: trajectory

### サービスの終了・方向転換
- claim: UpHabit は 2026-04-09 にパーソナルCRMを終了した（8年以上続いた）。その前の2022年に「Relationship Selling」や「Salesforce Hygiene」へ方向を変えていた。uphabit.com は 2026-11-12 に 503 エラーを返した。 | source: ContactsPlus "UpHabit alternative" https://www.contactsplus.com/uphabit-alternative/ （検索結果の要約から）と Dex 記事 | publisher: 競合2社 | pub_date: 2026 | accessed: 2026-11-12 | confidence: medium（競合2社が同じことを書いていて、公式サイトにもつながらない。ただし公式の終了告知は確認できていない） | class: trajectory
- claim: Garden（iOS。開発者が1人）は 2020年半ばから更新が止まっている。FollowUp は 2018年に買収されたあと、メールのリマインダーだけになった。Nouri はイベント運営（チケット販売や参加者どうしの交流）に方向を変えた。 | source: Dex 記事 https://getdex.com/blog/personal-crm-in-2020-20-startups-apps-and-failed-attempts | publisher: Dex（競合） | pub_date: 2026-07-07 | accessed: 2026-11-12 | confidence: medium | class: trajectory

### パーソナルCRMが続かない理由（使う人の声）
- claim: 「登録して数人入れたら、2週間以内に使わなくなる。原因はほぼ手入力」という見方が業者やブログで繰り返されている。Substack の書き手は「項目を増やすほど、更新しなくなる」と書いている。自作した人は「相手が転職しても更新せず、データが古くなった」と書いている。「a very organized graveyard」（よく整理された墓場。連絡先はあるのに関係の中身がない）という表現もある。 | source: 検索結果の要約（rivereditor.com "best personal crm no manual entry"、magneticgrowth.substack.com、medium.com/swlh "my homegrown personal crm"、goodword.com） | publisher: ブログや業者（自動取り込みを売り込みたい側が多い） | pub_date: 2024〜2026 | accessed: 2026-11-12 | confidence: medium（何年にもわたって同じ話が繰り返されている。ただし Reddit などの使う人の生の声は今回取れなかった） | class: sentiment

### 狙いが近い小さなアプリ（「会った人を覚える」用途。顔・場所・メモ）
- claim: WhatsHisFaceAgain（iOS、$2.99、個人開発）は、会った直後に名前・写真・メモ・会った場所を入れて、覚えていることから検索できる。評価はまだ表示されないほど少ない。QRで相手が自分で登録する機能はない。 | source: App Store https://apps.apple.com/us/app/id6770136593 | publisher: Apple App Store | pub_date: unknown（App ID の番号から2026年ごろとみられる。未確認） | accessed: 2026-11-12 | confidence: medium | class: feature/traction
- claim: MyNetworker（掲載サイトでは「Mingle Networking」。iOS）は 2026-07-08 に公開された。顔か名刺を撮る、名刺をまとめて読み取る、音声メモ（端末の中で文字にする）、会った場所を自動で記録して地図で見られる、イベントや話題でタグ付け、フォローのリマインダー、QR でのデジタル名刺、Attio/HubSpot との同期。データは端末の中だけ。「your private memory for the people you meet」とうたう。Pro は $6.99/年 か $19.99 の買い切り。評価は 5.0★（4件）、ダウンロードは1,000未満。 | source: mwm.ai "Mingle Networking" https://mwm.ai/apps/mingle-networking/6783495719 | publisher: アプリ紹介サイト（公式ではない） | pub_date: 2026 | accessed: 2026-11-12 | confidence: medium | class: feature/pricing/traction
- claim: 同じ「会った人を写真と場所で覚える」アプリは他にもある。Rememorate、Remet、Onetta、Nameory、Appstar、iMet、Octograf。これらは検索結果の要約に出てきただけで、個別には確かめていない。 | source: WebSearch の結果一覧 | publisher: 主に App Store の掲載ページ | pub_date: 色々 | accessed: 2026-11-12 | confidence: low | class: feature

### 日本市場
- claim: 日本の App Store で見つかった人脈管理アプリ「一生人脉」は中国の開発者のもの（中国語と英語のみ）。最初の版は 2025-12-04。人間関係の図、紹介者のひもづけ、「今日人脉」でその日会った人を素早く記録、関係の温度、AIで文面を下書き。データは端末の中に保存。¥150で購入、年会員は ¥1,500、買い切りは ¥2,000。評価はほぼない。 | source: App Store JP https://apps.apple.com/jp/app/id6756007860 | publisher: Apple App Store | pub_date: 2025-12〜 | accessed: 2026-11-12 | confidence: high | class: feature/traction
- claim: 日本語で書かれたパーソナルCRMの比較記事はほとんどなく、海外のツール（Dex、Mesh、OnePageCRM）を紹介するものが中心。日本で作られた個人向けの人脈管理アプリで、今も動いているものは今回見つからなかった。 | source: wavecnct.com 「2025年最新 おすすめのパーソナルCRMツール6選」 https://wavecnct.com/ja/blogs/2025-nen-saishin-osusume-no-pasonaru-crm-tsuru-6-sen ほか（検索結果の要約から） | publisher: 色々 | pub_date: 2025〜2026 | accessed: 2026-11-12 | confidence: low（調べ方が浅い） | class: positioning

## Comparison table

| product | 入り方 | 記憶の補助（写真 / 会った場所 / 会話メモ） | 料金 | 対象 | 状態 |
|---|---|---|---|---|---|
| Dex | LinkedIn・メール・カレンダー・メッセージ・電話の連絡先など15以上から自動同期 | 写真: 載っていない / 場所: 地図表示はあるが「会った場所」は載っていない / メモ: あり。リマインダーと AI の相手調べもある | 無料なし。$12〜20/月（Premium）、$20〜34/月（Pro） | LinkedIn をよく使う人、仕事の人脈づくり | 動いている（2026年に Outlook 連携を追加） |
| Mesh（旧 Clay） | メール・カレンダー・X・LinkedIn・FB・iMessage から自動、CSV | 載っていない / 載っていない / 載っていない（検索・グループ・Reconnect・近況の通知はある） | 無料（1,000件まで）、Pro $10/月、Team $40/人/月 | 人間関係を大切にしたい個人とチーム。AI 寄り | 動いている。2026-03 に名前を変更。Automattic の傘下 |
| Monica | vCard・CSV、手入力 | 写真: 載っていない / 「How you met」の項目あり / メモ・日記あり | 自分のサーバーなら無料。クラウド版は新規登録停止中 | 友人や家族を覚えておきたい、プライバシー重視の人 | v3 を作り直し中（2026年末予定）。モバイルアプリはその後 |
| Covve | 名刺・入館証・LinkedIn QR の読み取り、音声、デジタル名刺の交換 | 載っていない / 載っていない / 音声メモ・タグ | 不明（14日間お試し） | 展示会などの営業・マーケ担当 | 動いている。営業向けに方向転換 |
| UpHabit | — | — | — | — | 2026-04 に終了（競合の情報による） |
| Garden | — | — | — | — | 2020年から更新なし |
| MyNetworker / Mingle | 顔か名刺を撮る、音声、QR のデジタル名刺 | あり / 自動で記録・地図 / 音声メモ | $6.99/年 か $19.99 買い切り | 人脈づくり・旅行・プライバシー重視の人 | 2026-07 公開。小さな個人開発 |
| WhatsHisFaceAgain | 会った直後に手入力 | あり / あり / あり。覚えていることで検索 | $2.99 | 名前を忘れがちな人 | 動いている。小さい |
| 一生人脉 | 手入力（「今日人脉」）、紹介者のひもづけ | アイコン / 場所はなく「どう知り合ったか」 / やり取りの記録 | ¥150＋年 ¥1,500 | 中国語圏の個人 | 2025-12 公開。日本語なし |

## Leads worth chasing

- **「相手が自分のQRを読んで、その場で自分を登録する」機能を持つパーソナルCRMは、今回見た中に1つもなかった。** Covve と MyNetworker にはデジタル名刺やQRの交換があるが、自分の名刺を渡すためのもので、相手の記録を自分のノートに作る流れではない。次の回では Popl、Blinq、HiHello、Eight（Sansan）、LinkedIn の QR など、デジタル名刺のサービスを調べて確かめたい（D1 の範囲外かもしれない）。
- 大きい製品（Dex と Mesh）は「自動で取り込んで、AI で補う」方向に進んでいる。LinkedIn やメールで既につながっている人を前提にしていて、名刺も LinkedIn もない、イベントで一度会っただけの人は対象になりにくい。この見方は料金ページからの推測で、機能の詳しいページはまだ読んでいない。
- 「顔・会った場所・メモ」を前面に出したアプリは2025〜2026年に個人開発で次々出ているが、どれも評価が数件しかない。「欲しい人はいるが、広まっていない」のか「広める方法がない」のか、次の回で App Store のランキングや評価の数を確かめたい。
- 日本で作られた人脈管理アプリが見つからなかった。日本語での検索をもっと深くする必要がある（「名前 覚える アプリ」「交流会 メモ アプリ」「Eight 名刺 個人」など）。
- Mesh を Automattic が買った時期（2024年か2025年か）は情報によって違う。TechCrunch の記事で確かめたい。
- UpHabit の終了は、公式の告知（App Store の更新履歴や、利用者へのメール）で確かめたい。

## Looked for but could not find

- Nat.app、Fabriq、Queue、folk（個人で使う場合）、日本で作られたパーソナルCRMが今どうなっているか（予算の都合で個別に調べられなかった。Dex の2026年版まとめ記事にも出てこない）。
- Reddit や Google Play で、ここ12か月の低評価レビュー（検索しても Reddit のスレッドが出てこなかった）。
- 大きいパーソナルCRMで「顔写真」や「会った場所」を目玉にしているもの（Dex と Mesh の料金ページには出てこない）。
- 相手が自分で登録するQRの仕組みを持つ製品（見つからなかった）。
- Dex と Mesh の、ここ6か月の資金調達や利用者数（Mesh の「170 million relationships」以外）。
- コミュニティやイベントの場面、あるいは日本向けとはっきりうたうパーソナルCRM（MyNetworker が「the people you meet」とうたう程度）。
