// 読むだけのアカウントの帯（specs/013 FR-045、contracts/ui-routes.md「読むだけの帯」）。閉じられない。
// オーナーには理由と「契約する」か「支払いの画面を開く」を、チームの人には支払いの詳細を出さずに知らせる。
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { readOnlyMessage } from "./BillingRequiredDialog";

/**
 * 読むだけの帯。
 * @param props - reason：読むだけの理由（trial_ended・payment_failed・canceled・owner_inactive）
 * @returns 帯
 */
export function ReadOnlyBanner({ reason }: { reason: string }) {
  const action = reason === "owner_inactive" ? null : reason === "payment_failed" ? "支払いの画面を開く" : "契約する";
  return (
    <Alert
      variant="warning"
      role="status"
      className="flex flex-col gap-3 rounded-none border-x-0 border-t-0 px-4 sm:flex-row sm:items-center sm:justify-between md:px-5"
    >
      <AlertDescription className="text-foreground">{readOnlyMessage(reason)}</AlertDescription>
      {action && (
        <Button asChild size="sm">
          <Link to="/settings/billing">{action}</Link>
        </Button>
      )}
    </Alert>
  );
}
