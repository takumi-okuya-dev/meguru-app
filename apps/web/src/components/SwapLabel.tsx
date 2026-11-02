// 押すと文言が変わるボタンの文言（「コピー」→「コピーしました」、「接続を確かめる」→「確かめています…」など）。
// いちばん長い文言の幅を先に取っておき、文言が変わってもボタンの幅を変えない（隣や右寄せのボタンが動かないように。2026-11-02）。

/**
 * 幅を変えずに入れ替わる文言。
 * @param props - labels：入れ替わる文言（名前ごと）、show：今出す文言の名前
 * @returns 文言
 */
export function SwapLabel<K extends string>({ labels, show }: { labels: Record<K, string>; show: K }) {
  return (
    <span className="inline-grid justify-items-center">
      {(Object.keys(labels) as K[]).map((k) => (
        // 今の文言のほかは、幅を取るためだけに置く。見えず、読み上げもしない
        <span
          key={k}
          aria-hidden={k === show ? undefined : true}
          className={k === show ? "col-start-1 row-start-1" : "invisible col-start-1 row-start-1"}
        >
          {labels[k]}
        </span>
      ))}
    </span>
  );
}
