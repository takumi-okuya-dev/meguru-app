// Accountのホーム（001 US1、specs/002 US4・FR-017・FR-024b、contracts/ui-routes.md「ホーム」、docs/ui-design.md「ホーム」）。
// ChatGPTの最初の画面のように、中央に次にやることを1つだけ出し、その下に入力状況の3枚のカードを並べる。
import { useQuery } from "@tanstack/react-query";
import type { ProfileStatus } from "@threads-grower/shared";
import {
  ChevronRightIcon,
  MegaphoneIcon,
  SearchIcon,
  TargetIcon,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import { NextPostCard } from "@/components/NextPostCard";
import { PartnerJoinedNotice } from "@/components/team/PartnerJoinedNotice";
import { TokenWarnings } from "@/components/connect/TokenWarnings";
import { AutoPostNotices } from "@/components/AutoPostNotices";
import { AccountAvatar } from "@/components/AccountAvatar";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { PLAN_CHANGE_CONTACT } from "@/components/GrowerRequiredNotice";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { useCallbackResult } from "@/lib/callback-result";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { useCurrentAccount } from "@/pages/account-layout";

type Area = "strategy" | "promotions" | "research";

/**
 * 「次にやること」を決める（research.md R11）。上から順に、最初に当てはまるもの。
 * @param s - 入力状況
 * @returns 案内する画面と文言（すべて入力済みなら area は null で、投稿ストックへ案内する）
 */
function nextStep(s: ProfileStatus): { area: Area | null; title: string; body: string } {
  if (s.strategy.filledCount === 0) {
    return {
      area: "strategy",
      title: "まずは「課題」から埋めましょう",
      body: "誰に何を届けるかを決めておくと、投稿の方向性が定まります。",
    };
  }
  if (s.promotions.totalCount === 0) {
    return {
      area: "promotions",
      title: "次は「宣伝内容」を登録しましょう",
      body: "案内したいイベントやサービスがあれば登録します（なくても投稿は作れます）。",
    };
  }
  if (s.research.referencePostCount === 0) {
    return {
      area: "research",
      title: "次は「リサーチ」がおすすめです",
      body: "Threadsで伸びている投稿を保存しておくと、投稿の精度が上がります。",
    };
  }
  // 材料がそろったら、投稿ストックへ案内する（specs/003 contracts/ui-routes.md「ホーム」）
  return {
    area: null,
    title: "投稿をつくりましょう",
    body: "プロンプトをChatGPTやClaudeに送り、返ってきた投稿案を投稿ストックに登録します。",
  };
}

/**
 * Account のホーム。Account の表示、無料体験の案内、次にやること、入力状況の3枚のカード。
 * @returns Account のホーム
 */
export function AccountHome() {
  const account = useCurrentAccount();
  useCallbackResult({ username: account.username });
  const status = useQuery({
    queryKey: queryKeys.profileStatus(account.id),
    queryFn: () => api.getProfileStatus(account.id),
  });
  const s = status.data;
  // 読み込めなかったら、読み込み中のまま止めずに原因と再読み込みを出す
  if (status.isError)
    return <ApiErrorScreen error={status.error} onRetry={() => void status.refetch()} />;
  const step = s ? nextStep(s) : null;
  const canEdit = s?.access.canEdit ?? true;

  const cards: { area: Area; label: string; Icon: LucideIcon; text: string }[] = s
    ? [
        {
          area: "strategy",
          label: "課題",
          Icon: TargetIcon,
          text: `${s.strategy.filledCount}/${s.strategy.totalCount} 入力済み`,
        },
        {
          area: "promotions",
          label: "宣伝内容",
          Icon: MegaphoneIcon,
          text: `宣伝の対象 ${s.promotions.targetableCount}件（任意）`,
        },
        {
          area: "research",
          label: "リサーチ",
          Icon: SearchIcon,
          text: `参考投稿 ${s.research.referencePostCount}件（任意）`,
        },
      ]
    : [];

  return (
    <>
      <PageHeader title="ホーム" />
      <PageBody className="flex flex-col items-center gap-7 pt-10 md:pt-16">
        {account.role === "owner" && <PartnerJoinedNotice accountId={account.id} />}
        <TokenWarnings />
        <section className="flex flex-col items-center gap-1.5 text-center">
          <AccountAvatar account={account} className="size-14 text-lg" />
          <h1 className="text-[17px] font-semibold">{account.displayName ?? account.username}</h1>
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span>@{account.username}</span>
            <ConnectionBadge status={account.connectionStatus} />
          </div>
          {s?.access.inTrial && s.access.trialEndsAt && (
            <p className="mt-1 rounded-full bg-muted px-3 py-1 text-xs">
              無料体験中：{formatDate(s.access.trialEndsAt)}まで、すべての機能を使えます
            </p>
          )}
        </section>

        {!s ? (
          <div className="h-40 w-full animate-pulse rounded-2xl bg-muted" aria-busy="true" />
        ) : (
          <>
            <section className="space-y-1.5 text-center">
              {canEdit ? (
                <>
                  <h2 className="text-[22px] leading-snug font-semibold md:text-[26px]">
                    {step!.title}
                  </h2>
                  <p className="text-[15px] text-muted-foreground">{step!.body}</p>
                  {step!.area === null && (
                    <Button asChild className="mt-3 h-11 rounded-full px-5 md:h-9">
                      <Link to={`/accounts/${account.id}/stock`}>投稿ストックへ</Link>
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <h2 className="text-[22px] leading-snug font-semibold md:text-[26px]">
                    課題・宣伝内容・リサーチの編集は、プラン2以上で使えます
                  </h2>
                  <p className="text-[15px] text-muted-foreground">
                    保存済みの内容はそのまま残っています。{PLAN_CHANGE_CONTACT}
                  </p>
                </>
              )}
            </section>
            <NextPostCard accountId={account.id} />
            <AutoPostNotices accountId={account.id} />
            <nav aria-label="投稿の材料" className="grid w-full gap-2.5 md:grid-cols-3 md:gap-3">
              {cards.map(({ area, label, Icon, text }) => (
                <Link
                  key={area}
                  to={`/accounts/${account.id}/${area}`}
                  className={cn(
                    "flex items-center gap-3.5 rounded-2xl border bg-card px-4 py-3 hover:bg-accent md:flex-col md:items-start md:gap-1.5 md:py-4",
                    canEdit && step?.area === area && "border-foreground",
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className="flex flex-1 flex-col leading-snug">
                    <span className="font-semibold">{label}</span>
                    <span className="text-[13px] text-muted-foreground">{text}</span>
                  </span>
                  <ChevronRightIcon
                    className="size-4 text-muted-foreground md:hidden"
                    aria-hidden="true"
                  />
                </Link>
              ))}
            </nav>
          </>
        )}
      </PageBody>
    </>
  );
}
