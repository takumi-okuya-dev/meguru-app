// 「Threadsで許可する」を押す前の案内（specs/025-threads-account-guide contracts/ui-routes.md 1、US1・FR-001〜FR-003、モック1・2枚目）。
// 許可の画面はブラウザで threads.com にログインしているアカウントを使い、アプリから切り替えられない（research.md R1）。
import { THREADS_WEB_URL, accountGuideParts, accountSwitchSteps } from "@meguru/shared";
import { ExternalLinkIcon } from "lucide-react";
import { Toggle } from "@/components/settings/FeatureSwitches";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * threads.com を新しいタブで開くリンク。文字のリンクか、枠線のボタンの形で出す（URL・文言・新しいタブの指定はここだけ）。
 * @param props - button：枠線のボタンの形にするなら true
 * @returns リンク
 */
export function ThreadsWebLink({ button = false }: { button?: boolean }) {
  const link = (
    <a
      className={button ? undefined : "inline-flex items-center gap-1.5 underline underline-offset-4"}
      href={THREADS_WEB_URL}
      target="_blank"
      rel="noreferrer"
    >
      threads.comを開く
      <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
    </a>
  );
  if (!button) return link;
  return (
    <Button asChild variant="outline" className="h-10 rounded-full bg-background md:h-9">
      {link}
    </Button>
  );
}

/**
 * 押す前の案内。使うべきアカウントが決まっていれば@名前を太字で出し、閉じたトグルに切り替えの手順を入れる。
 * @param props - expected：使うべきアカウントのユーザー名（@なし。決まっていなければ null）、
 *   again：戻ってきたときにもう一度押すボタンの名前（接続し直すダイアログでは、ダイアログを開くボタンの名前）
 * @returns 案内
 */
export function ThreadsAccountGuide({ expected, again = "Threadsで許可する" }: { expected: string | null; again?: string }) {
  const { lead, check } = accountGuideParts(expected);
  return (
    // 警告ではないので、alert ではなく note にする（エラーの枠と区別する）
    <Alert role="note">
      <AlertDescription className="space-y-2 text-foreground">
        <p className="text-[13px] leading-relaxed">
          {lead}
          {check && (
            <>
              <strong className="font-semibold">{check.name}</strong>
              {check.rest}
            </>
          )}
        </p>
        <Toggle title="違うアカウントが出たときは" region="違うアカウントが出たときの手順">
          <ul className="space-y-0.5">
            {accountSwitchSteps(expected, again).map((s) => (
              <li key={s}>・{s}</li>
            ))}
          </ul>
          <ThreadsWebLink />
        </Toggle>
      </AlertDescription>
    </Alert>
  );
}
