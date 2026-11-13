// 紹介経由の売上（specs/collect/003-revenue-sharing User Story 3、FR-021）。見るだけで、分配には使わない。
import type { ReferralRow } from "@meguru/shared";
import { yen } from "../../lib/reception-model";

/**
 * 紹介経由の売上の表。
 * @param props - rows：紹介した人ごとの行
 * @returns 表
 */
export function ReferralTable({ rows }: { rows: readonly ReferralRow[] }) {
  if (rows.every((r) => r.name === null)) {
    return <p className="text-sm text-muted-foreground">紹介した人が入った名簿の人はいません。名簿の人を直すと、紹介した人を入れられます。</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] text-sm" aria-label="紹介経由の売上">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 text-left font-normal">紹介した人</th>
            <th className="py-2 text-right font-normal">人数</th>
            <th className="py-2 text-right font-normal">来場</th>
            <th className="py-2 text-right font-normal">支払い済み</th>
            <th className="py-2 text-right font-normal">振込待ち</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name ?? "__none__"} className="border-b last:border-b-0">
              <td className="py-2">{r.name ?? <span className="text-muted-foreground">紹介なし</span>}</td>
              <td className="py-2 text-right tabular-nums">{r.people}</td>
              <td className="py-2 text-right tabular-nums">{r.attended}</td>
              <td className="py-2 text-right tabular-nums">{yen(r.paid)}</td>
              <td className="py-2 text-right tabular-nums">{r.awaiting > 0 ? yen(r.awaiting) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
