// 招待リンクのQRコード（specs/008-team-operations research.md R5）。
// uqr の encode でマス目を作り、SVGの <rect> で描く（SVGの文字列をHTMLとして流し込まない）。
// 暗いテーマでも読み取れるよう、白地に黒で描く。
import { useMemo } from "react";
import { encode } from "uqr";

/**
 * QRコード。
 * @param props - value：載せる文字列（URL）、size：一辺の大きさ（px。96以上）、label：支援技術向けの名前
 * @returns QRコードのSVG
 */
export function QrCode({ value, size = 112, label = "招待リンクのQRコード" }: { value: string; size?: number; label?: string }) {
  const cells = useMemo(() => encode(value).data, [value]);
  const n = cells.length;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      className="shrink-0 rounded-lg border bg-white p-1.5"
    >
      <rect width={n} height={n} fill="#FFFFFF" />
      {cells.flatMap((row, y) =>
        row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#000000" /> : null)),
      )}
    </svg>
  );
}
