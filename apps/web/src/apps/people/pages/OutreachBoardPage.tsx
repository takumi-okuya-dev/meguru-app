// 「/people/events/:eventId/outreach」：会ごとの声かけの一覧（specs/people/002-sales-list spec US5、FR-108・SC-102）。
// 誘う会への声かけを「興味を聞いた・参加リンクを送った・来た」の3つにまとめ、人数と人（名前・最後に会った日・来てくれそう度・次にやること）を出す。
// 行から進み具合を変えられる（声かけの共通の部品）。まだリンクを送っていない人（興味を聞いた）を先に出す。スマートフォンでは縦に並べる。
import { OUTREACH_STAGES, type OutreachBoardRow } from "@meguru/shared/people";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { ApiError } from "@/lib/api-client";
import { NotFound, PageBody, PageHeader } from "@/shell";
import { formatHeldOn } from "../components/format";
import { ActionError, OutreachStageButtons } from "../components/outreach/OutreachControls";
import { useOutreachActions } from "../components/outreach/use-outreach-actions";
import { OUTREACH_STAGE_LABELS } from "../components/person/labels";
import { PersonBadges } from "../components/person/PersonBadges";
import { lastMetLabel } from "../components/person/PersonRow";
import { peopleApi } from "../lib/api";
import { eventPath, personPath } from "../lib/paths";
import { peopleQueryKeys } from "../lib/query-keys";

/**
 * 一覧の1行（名前・最後に会った日・印・進み具合のボタン）。
 * @param props - row：人と声かけ
 * @returns 行
 */
function BoardRow({ row }: { row: OutreachBoardRow }) {
  const actions = useOutreachActions();
  return (
    <li className="space-y-2 px-3 py-3">
      <Link to={personPath(row.id)} className="-mx-1 block min-h-11 rounded-lg px-1 py-0.5 hover:bg-accent">
        <div className="truncate font-medium">{row.displayName}</div>
        <div className="text-[13px] text-muted-foreground">{lastMetLabel(row.lastMetOn)}</div>
      </Link>
      <PersonBadges tags={[]} likelihood={row.likelihood} nextAction={row.nextAction} />
      <OutreachStageButtons
        outreach={row.outreach}
        pending={actions.pending}
        label={`進み具合：${row.displayName}`}
        onChange={(stage) => actions.setStage(row.outreach.id, stage)}
        onRemove={() => actions.drop(row.outreach.id)}
      />
      <ActionError error={actions.failed?.error} />
    </li>
  );
}

/**
 * 会ごとの声かけの一覧の画面。
 * @returns 画面
 */
export function OutreachBoardPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const board = useQuery({ queryKey: peopleQueryKeys.outreachBoard(eventId), queryFn: () => peopleApi.outreachBoard(eventId) });

  if (board.isPending) return <LoadingSkeleton />;
  if (board.isError) {
    if (board.error instanceof ApiError && board.error.code === "ITEM_NOT_FOUND") return <NotFound message="このイベントはありません" />;
    if (board.error instanceof ApiError && board.error.code === "VALIDATION_FAILED") return <NotFound message="声かけの一覧は、自分の会だけで見られます" />;
    return <ApiErrorScreen error={board.error} onRetry={() => void board.refetch()} />;
  }
  const { event, stages } = board.data;
  const total = OUTREACH_STAGES.invite.reduce((n, s) => n + stages[s].length, 0);

  return (
    <>
      <PageHeader title="声かけの一覧" />
      <PageBody className="space-y-4">
        <p className="text-sm text-muted-foreground">
          <Link to={eventPath(event.id)} className="underline">
            {formatHeldOn(event.heldOn)} {event.name}
          </Link>
          への誘い（{total}人）
        </p>
        {total === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">この会への声かけは、まだありません。誘う候補の「文をコピー」のあとに記録できます。</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {OUTREACH_STAGES.invite.map((s) => (
              <section key={s} aria-label={OUTREACH_STAGE_LABELS.invite[s]} className="min-w-0 space-y-1.5">
                <h2 className="flex items-baseline gap-2 text-sm font-medium">
                  {OUTREACH_STAGE_LABELS.invite[s]}
                  <span className="text-muted-foreground tabular-nums">{stages[s].length}人</span>
                </h2>
                {stages[s].length === 0 ? (
                  <p className="rounded-2xl border border-dashed px-3 py-4 text-center text-[13px] text-muted-foreground">いません</p>
                ) : (
                  <ul className="divide-y rounded-2xl border bg-card">
                    {stages[s].map((r) => (
                      <BoardRow key={`${r.outreach.id}:${r.outreach.stage}`} row={r} />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
