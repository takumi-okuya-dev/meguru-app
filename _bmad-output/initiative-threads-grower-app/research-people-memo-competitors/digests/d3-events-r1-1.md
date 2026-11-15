# D3 イベント・交流会での人の記録 — round 1

調査日: 2026-11-12。ツール呼び出し 18 回（上限に到達）。WebFetch で本文を確認できたのは 2 件（Luma ヘルプ、All About）。残りは検索結果の抜粋に頼っているため、一次ページで確認していない項目は confidence を下げている。

## Findings

### イベント・コミュニティ基盤（参加者が得られるもの）
- claim: Luma では、主催者がゲストリストを表示する設定にすると、イベントページを見た人は参加人数と一部の参加者の名前・プロフィール写真を見られる。全員の一覧は主催者と承認済みゲストだけが見られる。メールアドレスは表示されない。ゲスト同士でメッセージを送れるか、イベント後も一覧が見られるか、メモ機能があるかについてはヘルプページに記載がない。主催者はゲストリストを非表示にもできる | source: Luma Help "Event Guest List" https://help.luma.com/p/event-guest-list.md ／ "Managing Your Guest List" https://help.luma.com/p/managing-your-guest-list | publisher: Luma | pub_date: unknown | accessed: 2026-11-12 | confidence: medium（本文は確認済み、更新日は不明） | class: feature
- claim: Luma について「参加者のネットワーキングディレクトリがある」と書いたページがあるが、Luma 公式の文書では裏付けられなかった。一方で、Luma の参加者名・SNSハンドルを抜き出すスクレイパー（Apify）や、ゲストリストに LinkedIn 情報を足すツール（Databar、FindMyICP）が出回っている。参加者側に「あとで相手を確かめたい」需要があるのに、公式機能では満たされていないことをうかがわせる | source: geo.sig.ai https://geo.sig.ai/brands/luma-events.md ; Apify https://apify.com/forkoff/luma-get-attendees.md ; Databar https://databar.ai/explore/luma-api/get-event-guests | publisher: 第三者 | pub_date: unknown | accessed: 2026-11-12 | confidence: low | class: feature
- claim: GLOOK（GLOOK株式会社）は日本のビジネスパーソン向けイベントアプリで、App Store での名前は「あとからも繋がれるイベントアプリ」。参加者のプロフィールを見て後から連絡できること、同じイベントの参加者だけが見られる募集機能、勧誘・営業目的の人を事前に検知することをうたっている。無料。評価は約10件 | source: App Store "GLOOK - あとからも繋がれるイベントアプリ" https://apps.apple.com/jp/app/id6475799878 | publisher: Apple App Store（検索結果の抜粋） | pub_date: unknown | accessed: 2026-11-12 | confidence: low（長い URL で直接取得すると 404。掲載が続いているかは未確認） | class: feature/traction
- claim: 国内で「イベント・サークルで人とつながる」アプリには、つなげーと（趣味のサークル・イベント。「全国2万以上のサークルが登録」と記載）、TOIRO（コミュニティイベントアプリ）、異業種交流会 Summit!（チャットと名刺交換）がある。いずれもイベント探しや出会いが中心で、会った人を自分用に記録することを主な目的にしたものは見当たらなかった | source: App Store つなげーと https://apps.apple.com/jp/app/id1102122107 ; TOIRO https://apps.apple.com/jp/app/id6476542372 | publisher: App Store（検索結果の抜粋） | pub_date: unknown | accessed: 2026-11-12 | confidence: low | class: positioning
- claim: 海外の会議向けアプリ（Sched、Eventleaf、Grip）では、参加者ごとのプロフィールに QR があり、相手の QR を読むとアプリ内の連絡先に名前・会社・メールが保存される（Sched "My Contacts"、Eventleaf "Contact Swap"）。名札スキャンで見込み客を集める機能（lead retrieval）もある。どれも主催者がそのイベントのために導入するもので、つながりはそのイベントのアプリの中に閉じる | source: Sched guide https://sched.com/guide/attendee-networking-my-contacts/ ; Eventleaf https://www.eventleaf.com/best-event-management-practices/contact-swap ; Grip support https://support.grip.events/how-to-scan-badges-and-export-them | publisher: 各社 | pub_date: unknown | accessed: 2026-11-12 | confidence: medium | class: feature
- claim: 会議向けネットワーキングアプリの料金は主催者が払う。Whova と Brella は見積もり制で、料金を公開していない。Swapcard は「$610/年〜（200参加者）」と G2 や競合ページに書かれている（Swapcard の料金ページは参加者数で課金単位を定義）。費用感が大規模カンファレンス向けで、小さな交流会やバーイベントには合わない | source: Swapcard pricing https://swapcard.com/pricing-plans ; G2 Brella pricing https://www.g2.com/products/brella/pricing ; Whova blog https://whova.com/blog/swapcard-competitors-alternatives/ | publisher: Swapcard/G2/Whova | pub_date: 2025-11〜2026 | accessed: 2026-11-12 | confidence: low（$610 は一次ページで確認していない） | class: pricing
- claim: リベシティ（オンラインコミュニティ）のオフ会では、アプリのプロフィールにある QR を読み合ってつながる使い方が案内されている（スマホのカメラで読むとログイン画面になることがある、という注意つき）。コミュニティが自前のアプリを持っていれば、その中で QR 交換が完結する例 | source: リベシティ図書館 https://library.libecity.com/articles/01JXAA93BM0P1AHS2EK0CCDNMJ | publisher: リベシティ | pub_date: unknown | accessed: 2026-11-12 | confidence: low（抜粋のみ） | class: behavior

### 今の習慣と困りごと（日本）
- claim: 「合コンや異業種交流会など、リアルの場で一度に複数人とLINEの友だち登録する場合は更に厄介」で、誰が誰か分からなくなるのは普通のこととされる。対策として、相手ごとに表示名を変えることと、交換した直後にトークの「写真を撮る」で相手の顔写真（またはツーショット）を撮って背景に設定することが勧められている。つまり LINE の上で「顔写真＋識別名」を手作業で付けている | source: All About「合コンで大活躍!? LINEを一斉に交換する時の裏ワザ」 https://allabout.co.jp/gm/gc/458643/ | publisher: All About（原 久鷹） | pub_date: 2015-09-23 | accessed: 2026-11-12 | confidence: medium（困りごととしては古くからあるが、記事は約11年前で鮮度の基準外） | class: behavior/sentiment
- claim: LINE で友だちの表示名を変えても相手には通知されず、相手の画面にも反映されない、という解説が複数の非公式サイトで一致している。ただし非表示・ブロック中の相手は名前を変えられないなどの制約がある。「友だちのメモ」機能そのものの仕様は、公式ヘルプを含め今回は確認できなかった | source: Appllio https://appllio.com/line-friends-name-change ; linestep https://linestep.jp/2024/05/07/line-changename | publisher: Appllio / linestep | pub_date: 2024-05 ほか | accessed: 2026-11-12 | confidence: low〜medium | class: feature
- claim: 交流会で名前を思い出せないときの対処として、ビジネスの場なら名刺で乗り切れるが、プライベートの集まりでは別の方法が要り、正直に聞くのが確実だとする記事がある。名刺がない場ほど困る、という見立てと合う | source: 現代ビジネス https://gendai.media/articles/-/92368 | publisher: 講談社 現代ビジネス | pub_date: unknown | accessed: 2026-11-12 | confidence: low（抜粋のみ） | class: sentiment

### 統計
- claim: YouGov が 2022-07-11 に米国の成人 20,517 人を対象に「会った人を覚えるために記憶術を使うか」を調べている。二次報道（Upworthy）では「最近会った人の名前を半分以上の確率で思い出せない」が 58%、「一度も忘れない」が 7% とされているが、YouGov のページで設問文と数字の対応は確認できていない。2018 年にも YouGov が 2,468 人に、初対面の人の名前をどれだけ覚えられるかを聞いている | source: YouGov https://today.yougov.com/topics/politics/survey-results/daily/2022/07/11/2612b/3 ; https://today.yougov.com/topics/society/survey-results/daily/2018/10/19/6b3ae/2 ; Upworthy https://www.upworthy.com/suave-method-to-remember-names/ | publisher: YouGov / Upworthy | pub_date: 2022-07 / 2018-10 | accessed: 2026-11-12 | confidence: low〜medium（行動データの鮮度は2年以内が基準なので基準外。数字は二次情報） | class: behavior
- claim: 「紹介された直後に名前を忘れることがよくある」が 66.6% という調査（n=39,637）があるが、記憶トレーニングを売る memoryOS 自身の調査なので利害がある | source: memoryOS https://memoryos.com/article/4-in-5-people-say-memory-is-a-career-skill-but-almost-nobody-trains-it-data-reveals | publisher: memoryOS | pub_date: unknown | accessed: 2026-11-12 | confidence: low | class: behavior
- claim: 日本で「名前を覚えられない人の割合」「交流会で集めた連絡先の数」「LINE の友だち数」を、発行元とサンプル数つきで示した調査は見つからなかった。カオナビ（2018）の顔と名前の研究は n=14 の実験で、割合を示すものではない | source: カオナビ プレスリリース https://corp.kaonavi.jp/wp/wp-content/uploads/2018/09/pr_20180926.pdf | publisher: カオナビ | pub_date: 2018-09 | accessed: 2026-11-12 | confidence: low | class: behavior

### 主催者側（コミュニティ CRM）
- claim: Orbit（コミュニティ CRM）は単独のサービスとしてはもう続いていない。Postman に合流したという告知と、2024年に解散したという記述があり、時期の説明は食い違っている | source: Orbit blog "Orbit is joining Postman" https://orbit-website-duh.pages.dev/blog/orbit-is-joining-postman ; leadpipe https://www.leadpipe.com/blog/common-room-vs-orbit/ | publisher: Orbit / leadpipe | pub_date: unknown | accessed: 2026-11-12 | confidence: medium（終了したこと自体）／low（時期） | class: trajectory
- claim: Common Room は B2B 向けの販売・マーケティング用ツールに寄っていて、月 $2,500〜という記述がある（CostBench の 2026-05 の変更履歴とは数字が合わない）。2026-07 に Zoom に合流したという単独の記述もある。小さな社会人コミュニティには価格も用途も合わない | source: Octolens https://octolens.com/common-room-alternatives ; CostBench https://www.costbench.com/changelog/common-room-plan-added-2026-05/ | publisher: 比較サイト | pub_date: 2026 | accessed: 2026-11-12 | confidence: low | class: pricing/trajectory
- claim: 日本の社会人サークル運営では、名簿・連絡・予定と出欠をグループ管理アプリにまとめ、単発の飲み会は出欠表ツールを使い分けるのが一般的とする解説がある。Join It（海外）は会員証の QR チェックインを持つ。参加履歴は残せても、「誰と誰が会ったか」まで記録する機能は確認できなかった | source: atsoho https://atsoho.com/blog/club-attendance-management-apps ; Join It https://joinit.com/categories/social-clubs | publisher: atsoho / Join It | pub_date: unknown | accessed: 2026-11-12 | confidence: low | class: behavior

## Comparison table
| product/habit | 参加者が得られるもの | 相手の記録・メモ | 誰が払うか・料金 | 日本での使われ方 |
|---|---|---|---|---|
| LINE QR 交換（習慣） | 1対1・グループのトーク | 表示名の変更、トーク背景に写真（手作業の工夫）。会った場所や話した内容を構造立てて残す仕組みはない | 無料 | 交流会での交換手段として定番。誰が誰か分からなくなる困りごとは2015年の記事から確認できる |
| Instagram 交換（習慣） | フォロー、DM | なし（今回は未調査） | 無料 | 未確認（今回は根拠を取れていない） |
| Luma | 参加者の名前・写真（主催者が表示を選んだ場合） | 公式のメモ機能やイベント後の連絡機能は確認できず | 主催者（料金は未調査） | 東京のテック・英語圏寄りのイベントで使われる（未検証の推測） |
| connpass / Peatix | 未確認 | 未確認 | 主催者手数料（未確認） | 勉強会（connpass）、有料イベント（Peatix） |
| Sched / Eventleaf / Grip / Swapcard / Whova / Brella | イベント内の参加者一覧、QR で連絡先交換、マッチング | イベントアプリ内の連絡先（一部メモあり）。イベントごとに閉じる | 主催者。見積もり制、Swapcard は $610/年〜（200人、未確認） | 大規模カンファレンス向け。小さな交流会での利用は確認できず |
| GLOOK | 参加者プロフィール、後から連絡、参加者限定の募集 | 不明 | 参加者は無料 | 国内のビジネスイベント向け。評価約10件で規模は小さい |
| つなげーと / TOIRO / Summit! | イベント・サークル探し、チャット | 主目的ではない | 参加者無料（課金形態は未確認） | 社会人サークル・趣味の集まり |
| コミュニティアプリ内 QR（リベシティ） | アプリ内でフォロー | アプリ内のプロフィール | 会費制コミュニティ | 自前アプリを持つ大きなコミュニティに限られる |
| Common Room / Orbit | （主催者向け）メンバーの活動記録 | 主催者側の CRM | Common Room は月$2,500〜（食い違いあり）、Orbit は終了 | 日本の小さなコミュニティでの利用は確認できず |

## Leads worth chasing
- GLOOK が今も運営されているか（App Store の長い URL は 404、ID の URL は検索結果に出る）。プロフィールを見て後から連絡する機能に、メモがあるかどうか。
- Luma の公式機能で、イベント後も参加者一覧を見られるか、ゲスト同士で連絡できるか（ヘルプには記載なし）。「networking directory」の記述が本当かどうか。
- connpass と Peatix の参加者一覧の公開範囲と、参加者が見られる範囲（今回は根拠を取れなかった）。connpass の参加者一覧は公開されているという理解は検証していない。
- LINE 公式ヘルプの「友だちのメモ」機能の仕様（今回は見つからず）。
- 日本のユーザーの声（X、知恵袋、note）を直接取ること。検索エンジンでは記事しか出なかったので、site 指定や Yahoo!知恵袋での直接検索が必要。
- YouGov 2022 の設問文と、58% / 7% の数字が本当に対応しているか。
- 日本のコミュニティ運営ツール（例: commune、OSIRO などの名前が浮かぶが、今回は検索していないので未検証）が「誰と誰が会ったか」を記録するか。
- Instagram 交換が交流会でどれくらい使われているかの根拠。

## Looked for but could not find
- 日本で「名前を覚えられない」「LINE の友だちが誰か分からない」割合を、発行元とサンプル数つきで示した調査。
- 交流会1回で交換する連絡先の数や、LINE の友だち数の平均（発行元・サンプル数つき）。
- 小さな交流会やバーイベントで、参加者が QR で自分を主催者または他の参加者に登録する国内アプリ（会議向けの海外アプリ以外）。
- Luma、connpass、Peatix で、参加者が相手についてメモを残す公式機能。
- 鮮度の基準（12か月以内）を満たす、日本語の一次のユーザー投稿（今回取れたのは2015年の記事と解説記事だけ）。
