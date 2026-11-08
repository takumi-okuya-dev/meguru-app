// 違うアカウントで許可して戻ったときの、切り替えの手順（specs/025-threads-account-guide contracts/ui-routes.md 2、US2・FR-005・FR-006、モック3枚目）。
// エラーの枠の中で、エラーの文に続けて出す。その画面で次にする操作なので、手順は閉じずに出す。
import { THREADS_WEB_URL, accountSwitchSteps } from "@threads-grower/shared";
import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 切り替えの手順と「threads.comを開く」。
 * @param props - expected：使うべきアカウントのユーザー名（@なし。決まっていなければ null）、again：もう一度押すボタンの名前
 * @returns 手順
 */
export function AccountSwitchSteps({ expected, again }: { expected: string | null; again: string }) {
  return (
    <div className="space-y-3">
      <ol className="list-decimal space-y-0.5 pl-5 text-[13px] leading-relaxed">
        {accountSwitchSteps(expected, again).map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <Button asChild variant="outline" className="h-10 rounded-full bg-background md:h-9">
        <a href={THREADS_WEB_URL} target="_blank" rel="noreferrer">
          threads.comを開く
          <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
        </a>
      </Button>
    </div>
  );
}
