// 売上と残る額・分配の表（specs/collect/003-revenue-sharing User Story 1・2、FR-002・FR-012〜FR-016）。
// 主催者の分配の画面と、つながった運営メンバーの読むだけの画面で同じものを使う（you があれば自分の行に「あなた」）。
import { ratioLabel, SHARING_ROLE_LABELS, type Distribution, type SharingSnapshot } from "@meguru/shared";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { yen } from "../../lib/reception-model";

type Snapshot = Pick<SharingSnapshot, "revenue" | "expenseTotal" | "current" | "projected" | "reimbursements"> & {
  members: Pick<SharingSnapshot["members"][number], "id" | "name" | "role" | "ratioTenths">[];
};

/**
 * 売上・経費・残る額（今と見込み）。
 * @param props - snap：分配の数字
 * @returns 段
 */
export function RevenueSummary({ snap }: { snap: Snapshot }) {
  const rows: [string, string][] = [
    ["支払い済みの売上", yen(snap.revenue.paid)],
    ["振込待ち", yen(snap.revenue.awaiting)],
    ["経費", `− ${yen(snap.expenseTotal)}`],
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">今の残る額（支払い済みから）</div>
          <div className={cn("text-xl font-semibold tabular-nums", snap.current.amount < 0 && "text-destructive")} aria-label="今の残る額">
            {yen(snap.current.amount)}
          </div>
        </div>
        <div className="rounded-lg border border-dashed p-3">
          <div className="text-xs text-muted-foreground">振込待ちがすべて入ったとき</div>
          <div className={cn("text-xl font-semibold tabular-nums", snap.projected.amount < 0 && "text-destructive")} aria-label="見込みの残る額">
            {yen(snap.projected.amount)}
          </div>
        </div>
      </div>
      {snap.revenue.awaitingConfirmation > 0 && (
        <p className="text-xs text-muted-foreground">本人の申告の確かめ待ち {yen(snap.revenue.awaitingConfirmation)} は、どちらにも入れていません。</p>
      )}
    </div>
  );
}

/**
 * 分配の計算の内訳の言葉（FR-015）。
 * @param d - 分配の結果
 * @param members - 運営メンバー
 * @returns 内訳の行
 */
function breakdown(d: Distribution, members: Snapshot["members"]): string[] {
  if (d.count === 0) return [];
  const a = Math.abs(d.amount);
  const name = (id: string | null) => members.find((m) => m.id === id)?.name ?? "";
  const lines: string[] = [];
  if (d.count === 1) lines.push(`1人なので、${yen(a)}をすべて。`);
  else if (d.memberCount === 0) lines.push(`全員リーダーなので、${yen(a)}を倍率の比で分けます。`);
  else {
    for (const m of members.filter((x) => x.role === "leader")) {
      lines.push(`${m.name}（リーダー）：${yen(a)} ÷ ${d.count}人 × ${ratioLabel(m.ratioTenths ?? 12).replace("倍", "")}（円未満は切り捨て）`);
    }
    const leaderSum = d.shares.filter((s) => members.find((m) => m.id === s.memberId)?.role === "leader").reduce((x, s) => x + s.base, 0);
    lines.push(`メンバー：（${yen(a)} − ${yen(leaderSum)}）÷ ${d.memberCount}人（円未満は切り捨て）`);
  }
  const rem = d.shares.find((s) => s.remainder > 0);
  if (rem) lines.push(`端数 ${yen(rem.remainder)} は ${name(d.remainderTo)} に足しました。`);
  return lines;
}

/**
 * 分配の表（今と見込みを切り替える）。
 * @param props - snap：分配の数字、you：自分の運営メンバーの番号（つながった人の画面）
 * @returns 表
 */
export function DistributionTable({ snap, you }: { snap: Snapshot; you?: string }) {
  const [which, setWhich] = useState<"current" | "projected">("current");
  const d = snap[which];
  const back = new Map(snap.reimbursements.filter((r) => r.memberId).map((r) => [r.memberId!, r.amount]));
  const others = snap.reimbursements.filter((r) => r.memberId === null);
  const hasProjection = snap.projected.amount !== snap.current.amount;
  return (
    <div className="space-y-3">
      {hasProjection && (
        <div role="tablist" aria-label="分配のもと" className="inline-flex rounded-lg border p-0.5 text-sm">
          {(
            [
              ["current", "今"],
              ["projected", "見込み"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={which === k}
              className={cn("rounded-md px-3 py-1.5", which === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              onClick={() => setWhich(k)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {d.deficit && d.count > 0 && (
        <p role="status" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {d.amount < 0 ? `赤字 ${yen(-d.amount)}。` : "残る額は0円です。"}下の額は、同じ決まりで分けたときの負担の目安です。
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-normal">運営メンバー</th>
              <th className="py-2 text-right font-normal">{d.deficit ? "負担の目安" : "分配額"}</th>
              <th className="py-2 text-right font-normal">立て替えの戻し</th>
              <th className="py-2 text-right font-normal">受け取る合計</th>
            </tr>
          </thead>
          <tbody>
            {snap.members.map((m) => {
              const s = d.shares.find((x) => x.memberId === m.id);
              const b = back.get(m.id) ?? 0;
              const total = d.deficit ? b - (s?.total ?? 0) : (s?.total ?? 0) + b;
              return (
                <tr key={m.id} className={cn("border-b last:border-b-0", m.id === you && "bg-primary/5")} aria-label={`${m.name}の分配`}>
                  <td className="py-2">
                    <span className="font-medium">{m.name}</span>
                    {m.id === you && <span className="ml-1.5 rounded bg-primary px-1.5 text-xs text-primary-foreground">あなた</span>}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {SHARING_ROLE_LABELS[m.role]}
                      {m.role === "leader" && m.ratioTenths ? `・${ratioLabel(m.ratioTenths)}` : ""}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {yen(s?.total ?? 0)}
                    {s && s.remainder > 0 && <span className="block text-xs text-muted-foreground">端数 {yen(s.remainder)} を含む</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums">{b > 0 ? yen(b) : "—"}</td>
                  <td className={cn("py-2 text-right font-medium tabular-nums", total < 0 && "text-destructive")}>{yen(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {others.length > 0 && (
        <p className="text-xs text-muted-foreground">運営メンバーでない人への立て替えの戻し：{others.map((r) => `${r.name} ${yen(r.amount)}`).join("・")}</p>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">計算の内訳</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {breakdown(d, snap.members).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
