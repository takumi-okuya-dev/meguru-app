// 退会の手続きの途中の画面（specs/013 contracts/ui-routes.md「退会」）。退会のAPIのほかは止まっているので、「退会する」だけを出す。
import { useState } from "react";
import { CenteredLayout } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { WithdrawDialog } from "./WithdrawDialog";

/**
 * 退会の手続きの途中の画面。
 * @returns 画面
 */
export function WithdrawalInProgress() {
  const [open, setOpen] = useState(false);
  return (
    <CenteredLayout>
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold">退会の手続きの途中です</h1>
        <p className="text-sm text-muted-foreground">「退会する」をもう一度押して、手続きを終えてください。</p>
        <Button variant="destructive" className="rounded-full" onClick={() => setOpen(true)}>
          退会する
        </Button>
      </div>
      <WithdrawDialog open={open} onOpenChange={setOpen} />
    </CenteredLayout>
  );
}
