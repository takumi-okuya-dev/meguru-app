// 人のページの声かけの記録（誘う会・相談先ごとの進み具合と日時。specs/people/001-people-memo contracts/ui-routes.md 1、research.md R16）。
// 001の作り手は1人なので、記録したのは作り手。「あなたが記録」と出す。
import type { Outreach } from "@meguru/shared/people";
import { useId } from "react";
import { formatDateTime } from "@/lib/format";
import { formatHeldOn } from "../format";
import { OUTREACH_STAGE_LABELS } from "./labels";

/**
 * 声かけの各段の日時（あるものだけ、古い順）。
 * @param o - 声かけ
 * @returns 段の名前と日時
 */
function stageTimes(o: Outreach): { label: string; at: string }[] {
  const times: { label: string; at: string | null }[] =
    o.purpose === "invite"
      ? [
          { label: OUTREACH_STAGE_LABELS.invite.asked, at: o.askedAt },
          { label: OUTREACH_STAGE_LABELS.invite.link_sent, at: o.linkSentAt },
          { label: OUTREACH_STAGE_LABELS.invite.attended, at: o.attendedAt },
        ]
      : [
          { label: OUTREACH_STAGE_LABELS.work.asked, at: o.askedAt },
          { label: OUTREACH_STAGE_LABELS.work.approved, at: o.approvedAt },
          { label: OUTREACH_STAGE_LABELS.work.connected, at: o.connectedAt },
        ];
  return times.filter((t): t is { label: string; at: string } => t.at !== null);
}

/**
 * 声かけの見出し（誘う会、または相談先）。
 * @param o - 声かけ
 * @returns 見出し
 */
function outreachTitle(o: Outreach): string {
  if (o.purpose === "invite") return o.event ? `${formatHeldOn(o.event.heldOn)} ${o.event.name}への誘い` : "交流会への誘い";
  return o.targetName ? `仕事の相談先へのつなぎ（相談先：${o.targetName}）` : "仕事の相談先へのつなぎ";
}

/**
 * 今の段の名前。
 * @param o - 声かけ
 * @returns 名前
 */
function stageLabel(o: Outreach): string {
  return o.purpose === "invite"
    ? OUTREACH_STAGE_LABELS.invite[o.stage as keyof typeof OUTREACH_STAGE_LABELS.invite]
    : OUTREACH_STAGE_LABELS.work[o.stage as keyof typeof OUTREACH_STAGE_LABELS.work];
}

/**
 * 声かけの記録の段。
 * @param props - outreaches：声かけ
 * @returns 段
 */
export function PersonOutreachSection({ outreaches }: { outreaches: Outreach[] }) {
  const id = useId();
  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-sm font-medium text-muted-foreground">
        声かけの記録
      </h2>
      {outreaches.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだ声かけの記録はありません。誘う候補の画面から記録できます。</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {outreaches.map((o) => (
            <li key={o.id} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="min-w-0 font-medium break-words">{outreachTitle(o)}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">{stageLabel(o)}</span>
              </div>
              <ul className="text-muted-foreground">
                {stageTimes(o).map((t) => (
                  <li key={t.label}>
                    {t.label}：{formatDateTime(t.at)}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">あなたが記録</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
