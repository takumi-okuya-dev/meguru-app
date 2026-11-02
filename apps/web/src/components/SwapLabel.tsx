// 押すと文言が変わるボタンの文言（「コピー」→「コピーしました」、「保存」→「確かめています…」など）。
// いちばん長い文言の幅を先に取っておき、文言が変わってもボタンの幅を変えない（横や隣のボタンが動かないように。2026-11-02）。

/**
 * 幅を変えずに入れ替わる文言。
 * @param props - current：今の文言、labels：入れ替わるすべての文言（current を含めなくてよい）
 * @returns 文言
 */
export function SwapLabel({ current, labels }: { current: string; labels: readonly (string | undefined)[] }) {
  const others = [...new Set(labels)].filter((l): l is string => !!l && l !== current);
  return (
    <span className="inline-grid justify-items-center">
      <span className="col-start-1 row-start-1">{current}</span>
      {others.map((l) => (
        // 幅を取るためだけに置く。見えず、読み上げもしない
        <span key={l} aria-hidden="true" className="invisible col-start-1 row-start-1">
          {l}
        </span>
      ))}
    </span>
  );
}
