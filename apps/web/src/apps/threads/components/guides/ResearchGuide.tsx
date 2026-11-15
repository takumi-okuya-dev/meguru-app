// リサーチの画面の「伸びる投稿を見つけるリサーチ」（specs/014-strategy-guidance FR-060・FR-062、research.md R16）。
// 文はこのアプリの言葉で書き、成果（フォロワー・問い合わせが増えること）を約束する言い方をしない。
import { BookOpenIcon, ChevronDownIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Items({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * 伸びる投稿を見つけるリサーチのやり方。初めは閉じている。
 * @returns 読み物
 */
export function ResearchGuide() {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="rounded-2xl border bg-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-sm font-medium">伸びる投稿を見つけるリサーチ</span>
        <ChevronDownIcon className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <section
          id={bodyId}
          aria-label="伸びる投稿を見つけるリサーチ"
          className="space-y-4 border-t px-4 py-4 text-[13px] leading-relaxed"
        >
          <p className="text-muted-foreground">
            ほかのアカウントで反応が良かった投稿から、自分のアカウントでも使える「型」を見つけるためのやり方です。
          </p>
          <Part title="① 良い参考アカウントを見極める3つの指標">
            <Items
              items={[
                "フォロワー数：Threadsで1,000人以上が目安です。Instagramのフォロワー数とかけ離れていないかも見ます（Instagramだけ大きいアカウントは、Threadsの投稿の力とは限りません）。",
                "投稿の閲覧数：閲覧が2,000回以上の投稿が、いくつもあるか。1つだけ大きいものは、たまたまの場合があります。",
                "投稿頻度：最近まで続けて投稿しているか。昔だけ伸びていたアカウントは、今の参考になりにくいです。",
              ]}
            />
          </Part>
          <Part title="② 真似してよい投稿">
            <p>話の中身ではなく、組み立て方（型）を借ります。たとえば次のような型です。</p>
            <Items
              items={[
                "あるある共感型：「〇〇な人あるある」のように、読んだ人が「わかる」と思う場面を並べる",
                "気づき型：「〇年続けてわかったこと」のように、経験から得た一言を伝える",
                "ビフォーアフター型：「前は〇〇だったけど、今は〇〇」のように、変化を見せる",
                "まとめ型：「〇〇するときの3つのコツ」のように、短く整理して保存したくなる形にする",
                "問いかけ型：最後を「みんなはどうしてる？」のように、気軽に答えられる質問で終える",
              ]}
            />
          </Part>
          <Part title="③ 真似しない方がよい投稿">
            <Items
              items={[
                "愚痴・批判・炎上・あおりなど、ネガティブな気持ちだけで伸びた投稿",
                "有名人の知名度や、その人の実績・肩書きがあるから伸びた投稿",
                "その日の話題（時事ネタ）だけで伸びた投稿",
              ]}
            />
            <p>
              例外：始めはネガティブでも、最後に前向きな気づきに変わる投稿は、参考にしてかまいません。
            </p>
          </Part>
          <Part title="④ リサーチの5つの手順">
            <ol className="list-decimal space-y-1 pl-5">
              <li>届けたい人が検索しそうなキーワードで、Threadsを検索する</li>
              <li>閲覧やいいねが多い、伸びている投稿を見つける</li>
              <li>投稿したアカウントを、①の3つの指標で確かめる</li>
              <li>参考にしたい投稿を、この画面の「参考投稿を追加」で保存する</li>
              <li>投稿の中の特徴的な言葉で、もう一度検索して広げる</li>
            </ol>
          </Part>
          <Part title="⑤ 登録する前の5つの確認">
            <Items
              items={[
                "集めたい人（届けたい人）に届く投稿か",
                "自分のアカウントでも、くり返し使える型か",
                "コメントなど、反応の中身が良いか",
                "ネガティブな気持ちだけで伸びていないか",
                "投稿者の知名度や実績だけで伸びていないか",
              ]}
            />
            <p className="rounded-xl bg-muted/60 px-3 py-2">
              いちばん大事な考え方：一番バズった投稿を探すのではなく、集めたい人に届き、くり返し使える型を見つけることです。
            </p>
          </Part>
        </section>
      )}
    </div>
  );
}
