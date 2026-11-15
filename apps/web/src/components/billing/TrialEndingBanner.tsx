// 無料体験の終わりの帯（specs/013 FR-046、contracts/ui-routes.md「無料体験の終わりの帯」）。
// 契約がなく料金なしでもない利用者に、無料体験が終わる7日前から出す。閉じたら、その日（日本時間）は出さない。
import { useQuery } from "@tanstack/react-query";
import { TRIAL_ENDING_NOTICE_DAYS, jstToday, type MeBilling } from "@meguru/shared";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";

const keyOf = (day: string) => `trial-banner-dismissed:${day}`;

/**
 * 今日閉じたかを読む。読めなければ（プライベートブラウズなど）閉じていないとする。
 * @param day - 日本時間の日付
 * @returns 閉じていれば true
 */
function dismissedOn(day: string): boolean {
  try {
    return window.localStorage.getItem(keyOf(day)) === "1";
  } catch {
    return false;
  }
}

/**
 * 無料体験の終わりの帯。出す条件を満たさなければ何も出さない。
 * @param props - billing：/api/me の billing（読み込み前は undefined）
 * @returns 帯
 */
export function TrialEndingBanner({ billing }: { billing: MeBilling | undefined }) {
  const today = jstToday(new Date());
  const [dismissed, setDismissed] = useState(() => dismissedOn(today));
  if (!billing || billing.state !== "trial" || billing.trialDaysLeft === null) return null;
  if (billing.trialDaysLeft > TRIAL_ENDING_NOTICE_DAYS || dismissed) return null;
  const close = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(keyOf(today), "1");
    } catch {
      // 保存できなくても、この画面の間は閉じたままにする
    }
  };
  return (
    <Alert
      variant="warning"
      className="flex flex-col gap-3 rounded-none border-x-0 border-t-0 px-4 sm:flex-row sm:items-center sm:justify-between md:px-5"
    >
      <AlertDescription className="text-foreground">
        {billing.trialDaysLeft === 0
          ? "無料体験は今日で終わります。続けて使うには契約してください。"
          : `無料体験はあと${billing.trialDaysLeft}日で終わります。続けて使うには契約してください。`}
      </AlertDescription>
      <div className="flex items-center gap-1">
        <Button asChild size="sm">
          <Link to="/settings/billing">契約する</Link>
        </Button>
        <Button variant="ghost" size="icon" className="size-9" aria-label="閉じる" onClick={close}>
          <XIcon className="size-4" />
        </Button>
      </div>
    </Alert>
  );
}

/**
 * /api/me を読んで、無料体験の終わりの帯を出す（チームの画面・設定の画面。アカウントの画面は骨格が me を渡す）。
 * @returns 帯
 */
export function TrialEndingBannerFromMe() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  return <TrialEndingBanner billing={me.data?.billing} />;
}
