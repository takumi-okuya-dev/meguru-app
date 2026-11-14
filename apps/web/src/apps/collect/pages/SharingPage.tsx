// 分配（/collect/events/:eventId/sharing。specs/collect/003-revenue-sharing User Story 1〜3、tasks.md T018）。
// 売上と残る額 → 経費 → 運営メンバー → 分配 → 精算の手順（User Story 4） → 紹介経由の売上。変えるたびに API が返す数字で描き直す。
import type { SettlementSnapshot, SharingSnapshot } from "@meguru/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { formatJstShort } from "@/lib/format";
import { PageBody, PageHeader } from "@/shell";
import { DistributionTable, RevenueSummary } from "../components/sharing/DistributionTable";
import { ExpenseList } from "../components/sharing/ExpenseList";
import { InviteButton } from "../components/sharing/InviteButton";
import { MemberList } from "../components/sharing/MemberList";
import { ReferralTable } from "../components/sharing/ReferralTable";
import { SettlementSteps } from "../components/sharing/SettlementSteps";
import { collectApi } from "../lib/api";
import { collectErrorText } from "../lib/errors";
import { closingPath } from "../lib/paths";
import { collectQueryKeys } from "../lib/query-keys";

/**
 * 分配の画面。
 * @returns 画面
 */
export function SharingPage() {
  const { eventId = "" } = useParams();
  const queryClient = useQueryClient();
  const sharing = useQuery({ queryKey: collectQueryKeys.sharing(eventId), queryFn: () => collectApi.sharing(eventId) });
  const referrals = useQuery({ queryKey: collectQueryKeys.referrals(eventId), queryFn: () => collectApi.referrals(eventId) });
  const settlement = useQuery({ queryKey: collectQueryKeys.settlement(eventId), queryFn: () => collectApi.settlement(eventId) });

  /**
   * 変える呼び出しをして、返った数字で描き直す。
   * @param task - 呼び出し
   * @returns 成功したら true
   */
  const run = async (task: () => Promise<SharingSnapshot>): Promise<boolean> => {
    try {
      queryClient.setQueryData(collectQueryKeys.sharing(eventId), await task());
      // 経費・運営メンバーが変わると、精算の手順も変わる
      void queryClient.invalidateQueries({ queryKey: collectQueryKeys.settlement(eventId) });
      return true;
    } catch (e) {
      toast.error(collectErrorText(e));
      return false;
    }
  };

  /**
   * 精算の手順を変える呼び出しをして、返った数字で描き直す。
   * @param task - 呼び出し
   * @returns 成功したら true
   */
  const settle = async (task: () => Promise<SettlementSnapshot>): Promise<boolean> => {
    try {
      queryClient.setQueryData(collectQueryKeys.settlement(eventId), await task());
      return true;
    } catch (e) {
      toast.error(collectErrorText(e));
      return false;
    }
  };

  if (sharing.isPending) return <LoadingSkeleton />;
  if (sharing.isLoadingError) return <ApiErrorScreen error={sharing.error} onRetry={() => void sharing.refetch()} />;
  const s = sharing.data;
  const section = "space-y-3";

  return (
    <>
      <PageHeader title="分配" />
      <PageBody className="space-y-8">
        <div className="space-y-1">
          <h2 className="truncate font-medium">{s.event.name}</h2>
          <p className="text-sm text-muted-foreground">
            {formatJstShort(s.event.startsAt)}・
            <Link to={closingPath(eventId)} className="underline underline-offset-2">
              締めに戻る
            </Link>
          </p>
        </div>

        <section aria-labelledby="revenue-title" className={section}>
          <h2 id="revenue-title" className="text-sm font-medium">
            売上と残る額
          </h2>
          <RevenueSummary snap={s} />
        </section>

        <section aria-labelledby="expenses-title" className={section}>
          <h2 id="expenses-title" className="text-sm font-medium">
            経費
          </h2>
          <ExpenseList
            snap={s}
            onAdd={(input) => run(() => collectApi.addExpense(eventId, input))}
            onUpdate={(id, input) => run(() => collectApi.updateExpense(eventId, id, input))}
            onDelete={(id) => run(() => collectApi.deleteExpense(eventId, id))}
          />
        </section>

        <section aria-labelledby="members-title" className={section}>
          <h2 id="members-title" className="text-sm font-medium">
            運営メンバー
          </h2>
          <MemberList
            snap={s}
            onAdd={(input) => run(() => collectApi.addMember(eventId, input))}
            onUpdate={(id, input) => run(() => collectApi.updateMember(eventId, id, input))}
            onDelete={(id) => run(() => collectApi.deleteMember(eventId, id))}
            extra={(m) => (
              <InviteButton
                eventId={eventId}
                member={m}
                onChange={(next) =>
                  next
                    ? queryClient.setQueryData(collectQueryKeys.sharing(eventId), next)
                    : void queryClient.invalidateQueries({ queryKey: collectQueryKeys.sharing(eventId) })
                }
              />
            )}
          />
          <p className="text-xs text-muted-foreground">「招待」でリンクを送ると、運営メンバーはめぐるにログインして、このイベントの分配を読むだけで見られます。</p>
        </section>

        <section aria-labelledby="distribution-title" className={section}>
          <h2 id="distribution-title" className="text-sm font-medium">
            分配
          </h2>
          <DistributionTable snap={s} />
          <p className="text-xs text-muted-foreground">アプリはお金を動かしません。この額を見て、運営メンバーどうしで渡してください。</p>
        </section>

        <section aria-labelledby="settlement-title" className={section}>
          <h2 id="settlement-title" className="text-sm font-medium">
            精算の手順
          </h2>
          {settlement.isPending ? (
            <div className="h-20 animate-pulse rounded-lg bg-muted" aria-busy="true" />
          ) : settlement.isError ? (
            <ApiErrorScreen error={settlement.error} onRetry={() => void settlement.refetch()} />
          ) : (
            <SettlementSteps
              snap={settlement.data}
              members={s.members}
              onMark={(step) => settle(() => collectApi.markSettlementTransfer(eventId, { fromKey: step.fromKey, toKey: step.toKey, amount: step.amount }))}
              onUndo={(id) => settle(() => collectApi.undoSettlementTransfer(eventId, id))}
              onChooseHolder={(helperId, memberId) => settle(() => collectApi.chooseSettlementHolder(eventId, helperId, memberId))}
            />
          )}
        </section>

        <section aria-labelledby="referrals-title" className={section}>
          <h2 id="referrals-title" className="text-sm font-medium">
            紹介経由の売上
          </h2>
          <p className="text-xs text-muted-foreground">紹介した人ごとの数字です。分配の額には使いません。</p>
          {referrals.isPending ? (
            <div className="h-20 animate-pulse rounded-lg bg-muted" aria-busy="true" />
          ) : referrals.isError ? (
            <ApiErrorScreen error={referrals.error} onRetry={() => void referrals.refetch()} />
          ) : (
            <ReferralTable rows={referrals.data.rows} />
          )}
        </section>
      </PageBody>
    </>
  );
}
