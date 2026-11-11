// Accountのホーム（001 US1、specs/002 US4・FR-017・FR-024b、contracts/ui-routes.md「ホーム」、docs/ui-design.md「ホーム」）。
// ChatGPTの最初の画面のように、中央に次にやることを1つだけ出し、その下に入力状況の3枚のカードを並べる。
import { useQuery } from "@tanstack/react-query";
import { accountLabel, type ProfileStatus } from "@meguru/shared";
import {
  ChevronRightIcon,
  MegaphoneIcon,
  SearchIcon,
  TargetIcon,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import { NextPostCard } from "@/components/NextPostCard";
import { ShareAppCard } from "@/components/ShareAppCard";
import { AssignedNotice } from "@/components/team/AssignedNotice";
import { TokenWarnings } from "@/components/connect/TokenWarnings";
import { AutoPostNotices } from "@/components/AutoPostNotices";
import { NotConnectedBanner, connectPath } from "@/components/NotConnectedNotice";
import { featureOn, useAccountAccess } from "@/lib/use-account-access";
import { AccountAvatar } from "@/components/AccountAvatar";
import { IntroGuide } from "@/components/guides/IntroGuide";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { useCurrentAccount } from "@/pages/account-layout";

type Area = "strategy" | "promotions" | "research";

/**
 * 「次にやること」を決める（research.md R11）。上から順に、最初に当てはまるもの。
 * 使えないまとまりの画面は案内しない（specs/019 FR-004）。自動投稿を使えなければ、投稿をつくる案内も出さない。
 * @param s - 入力状況
 * @param on - strategy・autopost：そのまとまりを使えるか
 * @returns 案内する画面と文言（すべて入力済みなら area は null で、投稿をつくるへ案内する）。案内がなければ null
 */
function nextStep(s: ProfileStatus, on: { strategy: boolean; autopost: boolean }): { area: Area | null; title: string; body: string } | null {
  const create = on.autopost ? CREATE_STEP : null;
  if (!on.strategy) return create;
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
  return create;
}

/** 材料がそろったら、「投稿をつくる」の画面へ案内する（specs/003 contracts/ui-routes.md「ホーム」、specs/014 FR-164）。 */
const CREATE_STEP = {
  area: null,
  title: "投稿をつくりましょう",
  body: "プロンプトをChatGPTやClaudeに送り、返ってきた投稿案を投稿ストックに登録します。",
};

/**
 * Account のホーム。Account の表示、無料体験の案内、次にやること、入力状況の3枚のカード、アプリを紹介する。
 * @returns Account のホーム
 */
export function AccountHome() {
  const account = useCurrentAccount();
  // Threadsとつないだ結果と、招待へ戻す処理は「このアカウントの設定」で扱う（specs/012 research.md R4・R7）
  const notConnected = account.connectionStatus === "not_connected";
  const { access, can } = useAccountAccess(account.id);
  const strategyOn = featureOn(access, "strategy");
  const autopostOn = featureOn(access, "autopost");
  // 未接続で承認済みの案があれば、次にやることを「つなぐ」にする（Clarifications 2026-10-14）
  const counts = useQuery({
    queryKey: queryKeys.draftCounts(account.id),
    queryFn: () => api.getDraftCounts(account.id),
    enabled: notConnected && autopostOn,
  });
  const connectFirst = notConnected && can("owner") && (counts.data?.approved ?? 0) > 0;
  const status = useQuery({
    queryKey: queryKeys.profileStatus(account.id),
    queryFn: () => api.getProfileStatus(account.id),
  });
  const s = status.data;
  // 読み込めなかったら、読み込み中のまま止めずに原因と再読み込みを出す
  if (status.isError)
    return <ApiErrorScreen error={status.error} onRetry={() => void status.refetch()} />;
  const step = s ? nextStep(s, { strategy: strategyOn, autopost: autopostOn }) : null;
  const canEdit = s?.access.canEdit ?? true;

  // 戦略がOFFなら、課題・宣伝内容・リサーチのカードを出さない（specs/019 FR-004）
  const cards: { area: Area; label: string; Icon: LucideIcon; text: string }[] = s && strategyOn
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
        <IntroGuide />
        {notConnected && <NotConnectedBanner accountId={account.id} />}
        <AssignedNotice account={account} />
        <TokenWarnings />
        <section className="flex flex-col items-center gap-1.5 text-center">
          <AccountAvatar account={account} className="size-14 text-lg" />
          <h1 className="text-[17px] font-semibold">{accountLabel(account).primary}</h1>
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            {accountLabel(account).secondary && <span>{accountLabel(account).secondary}</span>}
            <ConnectionBadge status={account.connectionStatus} />
          </div>
          {s?.access.inTrial && s.access.trialEndsAt && (
            <p className="mt-1 rounded-full bg-muted px-3 py-1 text-xs">
              無料体験中：{formatDate(s.access.trialEndsAt)}まで
              {s.access.trialDaysLeft !== null ? `（あと${s.access.trialDaysLeft}日）` : ""}、すべての機能を使えます
            </p>
          )}
        </section>

        {!s ? (
          <div className="h-40 w-full animate-pulse rounded-2xl bg-muted" aria-busy="true" />
        ) : (
          <>
            <section className="space-y-1.5 text-center">
              {connectFirst ? (
                <>
                  <h2 className="text-[22px] leading-snug font-semibold md:text-[26px]">
                    Threadsにつないで自動投稿を始めましょう
                  </h2>
                  <p className="text-[15px] text-muted-foreground">
                    承認した案は、Threadsにつないで自動投稿をオンにすると投稿されます。
                  </p>
                  <Button asChild className="mt-3 h-11 rounded-full px-5 md:h-9">
                    <Link to={connectPath(account.id)}>Threadsにつなぐ</Link>
                  </Button>
                </>
              ) : canEdit && step ? (
                <>
                  <h2 className="text-[22px] leading-snug font-semibold md:text-[26px]">
                    {step.title}
                  </h2>
                  <p className="text-[15px] text-muted-foreground">{step.body}</p>
                  {step.area === null && (
                    <Button asChild className="mt-3 h-11 rounded-full px-5 md:h-9">
                      <Link to={`/accounts/${account.id}/create`}>投稿をつくる</Link>
                    </Button>
                  )}
                </>
              ) : canEdit ? null : (
                <>
                  <h2 className="text-[22px] leading-snug font-semibold md:text-[26px]">
                    このアカウントは今、読むだけです
                  </h2>
                  <p className="text-[15px] text-muted-foreground">保存済みの内容はそのまま残っています。</p>
                </>
              )}
            </section>
            {/* 自動投稿を使えなければ、次の投稿と自動投稿の知らせを出さない（specs/019 FR-004） */}
            {autopostOn && <NextPostCard accountId={account.id} />}
            {/* 未接続の知らせは、上の帯で出しているので重ねない */}
            {autopostOn && <AutoPostNotices accountId={account.id} hideNotConnected />}
            {cards.length > 0 && (
            <nav aria-label="投稿の材料" className="grid w-full gap-2.5 md:grid-cols-3 md:gap-3">
              {cards.map(({ area, label, Icon, text }) => (
                <Link
                  key={area}
                  to={`/accounts/${account.id}/${area}`}
                  className={cn(
                    "flex items-center gap-3.5 rounded-2xl border bg-card px-4 py-3 hover:bg-accent md:flex-col md:items-start md:gap-1.5 md:py-4",
                    canEdit && !connectFirst && step?.area === area && "border-foreground",
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
            )}
            <ShareAppCard />
          </>
        )}
      </PageBody>
    </>
  );
}
