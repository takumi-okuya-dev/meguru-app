// 受付用リンクのQRコード（specs/collect/001-event-day-collection research.md R18、tasks.md T051）。
// Web にある uqr でマス目を作り、SVG の <rect> で描く（SVG の文字列をHTMLとして流し込まない）。アプリ同士で部品を使えないので、
// Threads の QR の部品は使わずに集金管理の中に置く。暗いテーマでも読み取れるよう、白地に黒で描く。
import { useMemo } from "react";
import { encode } from "uqr";

/**
 * QRコード。
 * @param props - value：載せる文字列（URL）、size：一辺の大きさ（px）、label：支援技術向けの名前
 * @returns QRコードのSVG
 */
export function QrCode({ value, size = 200, label = "受付用リンクのQRコード" }: { value: string; size?: number; label?: string }) {
  const cells = useMemo(() => encode(value).data, [value]);
  const n = cells.length;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" className="shrink-0 rounded-lg border bg-white p-2">
      <rect width={n} height={n} fill="#FFFFFF" />
      {cells.flatMap((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#000000" /> : null)))}
    </svg>
  );
}
