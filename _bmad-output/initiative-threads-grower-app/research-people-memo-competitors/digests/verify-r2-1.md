# 強みの根拠の確かめ — round 2

調べた日: 2026-11-12。使ったのは web 検索と web 取得だけ。ツール呼び出しの上限（20回）に達したため、Dex と Mesh の公式ページ、および2つ目の独立した出典は一部取れていない。「検索要約」と書いた項目は、検索エンジンがまとめた要約経由の情報で、元ページを自分では開いていない。そのぶん確度は1段下げている。

## Claim checks

- claim 1a（HiHello：受け取った側が自分の情報を送り返せる交換機能が、無料プランにもある） | status: verified（確度は中） | sources: HiHello Pricing https://www.hihello.com/pricing （HiHello、日付表示なし、accessed 2026-11-12）; "Your Brand. Your Leads: Complete Control Over Contact Exchange" https://www.hihello.com/blog/your-brand-your-leads-complete-control-over-contact-exchange （HiHello blog、Last Updated 2025-10-13）; ヘルプ記事 "Custom Contact Exchange and Consent Forms" https://support.hihello.com/hc/en-us/articles/28136255611035 （取得しようとしたら 403。中身は検索要約でだけ確認） | note: 料金ページの比較表では、無料の Personal に QR などで共有する機能が含まれている。ヘルプ記事（検索要約）には「Exchange information をオフにすると、受け取った側はカードを見て保存するだけになる」とある。つまり送り返し機能はオンとオフを切り替えられ、標準でついている機能。2024-08-27 から Free / Professional / Business / Enterprise の全プランで新しい交換画面が使える、という HiHello ブログの記述も検索要約で見つかった。ただし元記事は開けていない。出典はどれも HiHello 自身のもので、独立した2つ目の出典はない。
- claim 1b（HiHello：同意フォームを無料プランで使える） | status: overturned | sources: HiHello Pricing（上と同じ） | note: 料金表で、Personal（Free）の「Custom contact exchange settings」「Standard form」「Consent capture」は3つとも "Not included"。同意フォームや、入力項目を自分で決められるフォームは有料プランの機能。
- claim 1c（HiHello の現在の料金） | status: verified（HiHello 公式のみ） | sources: HiHello Pricing | note: Personal は無料（"Free forever"）。Professional は $8/月（月払い）、年払いなら $6/月（年 $72）。Business（5〜100人）は1人あたり $6/月（月払い）、年払いなら $5/月で、26人と51人を超えると単価が下がる。Enterprise（100人以上）は価格を公開していない。App Store の表示は Professional $9/月（検索要約）で、公式料金ページの数字とずれている。
- claim 2（Blinq：無料プランはタグ無制限で、AI ノートは直近30日分。リード獲得フォームは Business 以上で、1件 $9.99 くらい） | status: verified（ただし言い回しに注意） | sources: Blinq Pricing https://blinq.me/pricing （Blinq、accessed 2026-11-12） | note: 無料プランの欄には "Unlimited tags for contacts" と "AI Notetaker (access notes from the last 30 days)" と書かれている。"Custom qualifiers & lead forms" が載っているのは Business（年払いでカード1枚あたり $4.99/月、月払いなら $6.99/月、5枚から）だけ。"$9.99 per lead captured and enriched" は「リードを集めて、相手の情報を補ってくれる（enrichment）」ためのクレジット料金で、月ごとの請求、まとめ買いの割引あり。フォームそのものの利用料ではない。ほかのプランは、Premium が $9.99/月（年払いなら $7.33）、Pro が $22.49/月（年払いなら $16.58）、Enterprise は見積もり。Blinq 以外の出典では確かめていない。
- claim 3（Popl：リード獲得は個人ではなくチーム向けに見積もりで売っている。個人プランの値段） | status: 前半は verified、個人プランの値段は unverified | sources: Popl Pricing https://popl.co/pages/pricing （Popl、accessed 2026-11-12）; Popl /pro https://popl.co/pro （Popl、accessed 2026-11-12）; Capterra の Popl ページ（検索要約で見ただけ） | note: 料金ページには金額が1つも載っていない。チーム向けプランは "Request Pricing" ボタンからの見積もりで、"Talk to our sales team and we'll provide you with a quote" とある。/pro ページにも "Contact us for a custom quote" とあり、個人の値段は書かれていない。"Custom lead capture forms" という言葉は料金ページに出てくるが、どのプランに入るかは書かれていない。Pro を $7.99/月（年払いなら $6.49）とする情報は検索要約と Capterra に出てくるが、いま見える公式ページでは確かめられない。古い価格の可能性がある。
- claim 4a（Prairie Card：受け取った側ができるのは、メールで受け取るか電話帳に保存するかだけ） | status: verified | sources: プレーリーカード マニュアル「読み取った側の情報保存方法」 https://docs.channel.io/prairie_manual/ja/articles/293c38c3-読み取った側の情報保存方法 （株式会社スタジオプレーリー、更新日の表示なし、accessed 2026-11-12）; https://prairie.cards/ （公式トップ） | note: 保存方法は2つだけ。1つは「連絡先やプロフィールページURLをメールで『読み取った方の受信箱』にお届け」、もう1つは「標準の連絡先アプリに…保存」。トップページでは、Eight / Sansan / myBridge と連携して名刺を管理する案内もしている。
- claim 4b（Prairie Card：受け取った側はメモやタグをつけられず、自分の情報を送り返すフォームもない） | status: verified（「書かれていない」ことの確認なので確度は中） | sources: 上の2つ | note: 受け取った側に届くのは「連絡先メモ」という名前のメールで、中身はカードの持ち主の情報。受け取った側が自分でメモを書く機能ではない。そのメールに返信すると持ち主に直接届く場合がある（持ち主がメールアドレスを登録しているとき）。ただ、これは返信メールであってフォームではない。持ち主に読み取った人の情報が届くという記述も見つからない。メモやタグの機能、送り返しフォームは、トップページにもマニュアルにも書かれていない。
- claim 4c（Prairie Card の個人向け価格） | status: verified | sources: https://prairie.cards/ | note: カードは買い切り（税込）で、公式デザイン 3,980円、ナチュラルウッド 4,480円、カスタムデザイン 4,980円、ブラックメタル 14,980円、ギフト 4,980円。月額はどのカードも0円。
- claim 4d（Prairie Card の利用者数は 250万人か 100万人以上か） | status: disputed（同じページの中で数字が食い違っている） | sources: https://prairie.cards/ | note: 2つの数字は、どちらもトップページの中にある。ページ上部のバッジは「累計利用人数250万人達成」、同じページのよくある質問は「累計100万人以上が利用しています」。よくある質問の文が古いまま残っていると考えるのが自然なので、250万人のほうを今の数字とみなす。ただし実際の人数を確かめられる独立した出典は見つけていない。引用するなら「公式は250万人と主張」と書くのが安全。
- claim 5a（Luma：主催者がカレンダーの連絡先にタグをつけ、イベントのチェックイン回数で並べ替え、タグで絞り込んで招待できる） | status: verified | sources: "Managing Calendar Contacts" https://help.luma.com/p/managing-calendar-contacts （Luma Help、検索要約で確認）; "Inviting and Adding Guests to Your Event" https://help.luma.com/p/inviting-and-adding-guests-to-your-event （Luma Help、accessed 2026-11-12） | note: タグをつけるのは People タブで、絞り込みにも使える。並べ替えは、名前・チェックインしたイベント数・登録したイベント数でできる（検索要約）。タグは2種類あり、メンバータグは管理者にしか見えない。招待するときは、"All Contacts" / "Contact Tags" / "Membership Tiers" のどれかで相手を選べる（"If you've organized contacts into tags, you can invite specific tags."）。「過去の参加者」という絞り込みは用意されていない。
- claim 5b（Luma：招待はメール・SMS / WhatsApp・アプリ通知で届き、LINE はない） | status: verified | sources: 上の招待ヘルプ; Luma Pricing https://luma.com/pricing | note: 招待ヘルプには "reach guests across email, SMS, WhatsApp, and push notifications" とあり、SMS と WhatsApp は電話番号を登録している人だけに届く。LINE はどこにも出てこない。
- claim 5c（Luma：参加者ごとに自由にメモを書く欄はない） | status: unverified（見た範囲では書かれていない） | sources: 上の招待ヘルプ（メモの記述なし） | note: 開いたのは招待のヘルプだけ。連絡先管理の記事は検索要約しか見ていないので、「メモ欄はない」とまでは言い切れない。
- claim 5d（Luma Plus の値段と、無料プランの送信上限） | status: verified（Luma 公式のみ） | sources: Luma Pricing | note: Plus は "$59 Per month, billed annually"（"Save 14%" と表示）。月払いの金額は書かれていない。無料プランは "Send up to 500 invites or newsletters per week"、Plus は週5,000通まで。
- claim 6a（Dex：人の写真、出会った場所、名刺の読み取り、QR 交換の機能はあるか。値段） | status: 機能は unverified、値段は disputed | sources: Dex の料金ページ https://getdex.com/pricing.md （検索要約で確認）; Software Advice の Dex ページ（検索要約で確認）; Dex ブログ（2026-03-30 の記事。検索要約で確認） | note: 4つの機能はどれも、検索結果からは確かめられなかった。Dex の機能ページやヘルプは開けていない。値段は、Premium $12/月・Professional $20/月という情報が多く、それが年払いの値段なのか月払いの値段なのかは出典ごとにばらばら。無料プランについても「ない」「7日間の無料体験だけ」「無料で始められる」と出典ごとに食い違っている。「無料プランはなく、年払いで $12/月から」という主張は公式ページで確かめられていない。
- claim 6b（Mesh、旧 Clay：機能、値段、名前が変わった時期と持ち主） | status: unverified / disputed | sources: Dex ブログ "Mesh review"（2026-04-06）; happenstance.ai の Dex と Mesh の比較; Solanasis の調査メモ（2026-03-18）。いずれも検索要約で確認 | note: 「無料は1,000件まで」の出典は、競合の Dex が書いたものだけ（Dex のレビューには「直近1,000件を検索できる」とある）。Pro $10/月という数字も、比較サイト1つにしか出てこない。名前が変わった時期は、2026年だとする出典と2024年だとする出典（App Store の掲載とレビュー記事）があり、食い違っている。公式発表は見つけていない。持ち主（運営会社）も確かめられなかった。Mesh の公式サイト（me.sh）は開けていない。

## Absence check (queries run, results)

- 実行した検索: "app remember people you met suggests who to invite to your next event"（extended モードで1回）。日本語（「誘う人 おすすめ」）と "who to invite AI" は、呼び出し回数が足りず検索していない。
- 見つかったもの（どれも検索要約で見ただけで、元ページは開いていない）:
  - Apple Calendar（Mac）: 招待する人を2人入れると、これまでのやりとりをもとに3人目を提案する。ヘルプは約1,381日前のもので古い。人のメモ機能はない。
  - MeetWho（meetwho.app）: イベントを開く側のツール。"Interaction graph" で「誰が誰とどのイベントで会い、その後どうなったか」を記録し、参加者どうしが会うべき相手を提案する。今回探した組み合わせに一番近い。ただし個人のメモ帳ではなく主催者向けのツールで、LINE で送れるかどうかは分からない。詳しく調べる価値がある。
  - Nearify / ThinkMatch: イベントの前に「会うべき人」を示し、会った人を保存する。次のイベントに誰を誘うかを提案する機能ではない。
  - Friendly Reminder: 友だちと会う予定のためのアプリ。「しばらく会っていない人」を提案する。イベントで出会った人を記録するアプリではない。
  - Memoris: 会った人を、そのときの状況と一緒に記録するアプリ。招待の機能はほとんどない。
- 結論（暫定）: 「出会った人の個人メモ」と「次のイベントに誘う人の提案」の両方を中心に据えた製品は、今回の1回の検索では見つからなかった。いちばん近いのは MeetWho（主催者が使う、人のつながりの記録＋会うべき人の提案）。検索が1回だけなので、「存在しない」とはまだ言えない。

## Could not check

- HiHello ヘルプ記事の本文（403 で開けず）と、独立した2つ目の出典。
- Blinq、Popl、Luma の独立した2つ目の出典（どれも各社の公式ページだけで確かめた）。
- Popl の個人プランの値段が今いくらか（公式ページに載っていない）。
- Dex と Mesh の機能ページ、Mesh の公式料金、Clay から Mesh への名前の変更の日付と持ち主。
- Luma の連絡先にメモ欄があるかどうか（連絡先管理のヘルプ記事を直接開けていない）。
- 誰も作っていないかの確認（absence check）での日本語の検索と、MeetWho のページの直接の確認。
