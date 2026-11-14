// 精算の手順（specs/collect/003-revenue-sharing User Story 4、FR-030〜FR-032、tasks.md T037）。
// だれがいくら持っていて、いくら受け取るかと、「だれがだれにいくら渡すか」。渡したら「渡した」を押す（取り消せる）。
import type { SettlementSnapshot } from "@meguru/shared";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatJstShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { yen } from "../../lib/reception-model";

type Step = SettlementSnapshot["steps"][number];

/** 手伝う人の選び方の「運営メンバーでない」。 */
const NOT_MEMBER = "__none__";

const KIND_LABELS: Record<SettlementSnapshot["parties"][number]["kind"], string> = {
  member: "",
  helper: "手伝う人",
  payer: "立て替えた人",
  former: "今は運営メンバーでない",
};

/**
 * 精算の手順の段。
 * @param props - snap：精算の数字、members：運営メンバー（手伝う人の対応の候補）、onMark：渡した、onUndo：取り消す、onChooseHolder：手伝う人の対応を選ぶ
 * @returns 段
 */
export function SettlementSteps({
  snap,
  members,
  onMark,
  onUndo,
  onChooseHolder,
}: {
  snap: SettlementSnapshot;
  members: { id: string; name: string }[];
  onMark: (step: Step) => Promise<boolean>;
  onUndo: (transferId: string) => Promise<boolean>;
  onChooseHolder: (helperId: string, memberId: string | null) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * 1つずつ押せるようにして呼ぶ。
   * @param key - 押した行の印
   * @param task - 呼び出し
   */
  const once = async (key: string, task: () => Promise<boolean>) => {
    setBusy(key);
    try {
      await task();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        今の分配額（支払い済みから）で精算します。PayPay・振込は主催者の口座に、現金は受け取った人の手元にあるとして数えます。立て替えた人のない経費は、主催者が払ったものとします。
      </p>

      {snap.helpers.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            受付で現金を受け取った手伝う人
          </h3>
          <ul className="divide-y rounded-lg border" aria-label="現金を受け取った手伝う人">
            {snap.helpers.map((h) => (
              <li key={h.helperId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{h.name}</span>
                  <span className="ml-2 tabular-nums text-muted-foreground">
                    現金 {yen(h.cash)}
                  </span>
                  {!h.chosen && h.memberId && (
                    <span className="block text-xs text-muted-foreground">
                      名前が同じなので、同じ人とみなしています
                    </span>
                  )}
                </div>
                <select
                  aria-label={`${h.name}はどの運営メンバーか`}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={h.memberId ?? NOT_MEMBER}
                  disabled={busy !== null}
                  onChange={(e) =>
                    void once(`h:${h.helperId}`, () =>
                      onChooseHolder(
                        h.helperId,
                        e.target.value === NOT_MEMBER ? null : e.target.value,
                      ),
                    )
                  }
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                  <option value={NOT_MEMBER}>運営メンバーでない</option>
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          いま持っている額と受け取る合計
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[20rem] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 text-left font-normal">人</th>
                <th className="py-1.5 text-right font-normal">持っている額</th>
                <th className="py-1.5 text-right font-normal">受け取る合計</th>
              </tr>
            </thead>
            <tbody>
              {snap.parties.map((p) => (
                <tr key={p.key} className="border-b last:border-b-0">
                  <td className="py-1.5">
                    {p.name}
                    {KIND_LABELS[p.kind] && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {KIND_LABELS[p.kind]}
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "py-1.5 text-right tabular-nums",
                      p.holding < 0 && "text-destructive",
                    )}
                  >
                    {yen(p.holding)}
                  </td>
                  <td
                    className={cn(
                      "py-1.5 text-right tabular-nums",
                      p.target < 0 && "text-destructive",
                    )}
                  >
                    {yen(p.target)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {snap.mismatch !== 0 ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          持っている額と受け取る合計が {yen(Math.abs(snap.mismatch))}{" "}
          合わないため、手順を出せません。受付の記録と経費を確かめてください。
        </p>
      ) : snap.steps.length === 0 ? (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {snap.done.length > 0
            ? "精算は終わりました。全員が受け取る合計を持っています。"
            : "渡すものはありません。"}
        </p>
      ) : (
        <ol className="divide-y rounded-lg border" aria-label="精算の手順">
          {snap.steps.map((s) => {
            const key = `${s.fromKey}>${s.toKey}`;
            return (
              <li
                key={key}
                className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                aria-label={`${s.fromName}から${s.toName}へ`}
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <span className="font-medium">{s.fromName}</span>
                  <ArrowRightIcon className="size-4 text-muted-foreground" aria-label="から" />
                  <span className="font-medium">{s.toName}</span>
                  <span className="ml-auto font-semibold tabular-nums">{yen(s.amount)}</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void once(key, () => onMark(s))}
                >
                  渡した
                </Button>
              </li>
            );
          })}
        </ol>
      )}

      {snap.done.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">渡したもの</h3>
          <ul className="divide-y rounded-lg border" aria-label="渡したもの">
            {snap.done.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm text-muted-foreground"
              >
                <CheckIcon className="size-4 text-primary" aria-label="渡した" />
                <div className="min-w-0 flex-1">
                  {t.fromName} → {t.toName}{" "}
                  <span className="tabular-nums text-foreground">{yen(t.amount)}</span>
                  <span className="ml-2 text-xs">{formatJstShort(t.doneAt)}</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void once(t.id, () => onUndo(t.id))}
                >
                  取り消す
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
