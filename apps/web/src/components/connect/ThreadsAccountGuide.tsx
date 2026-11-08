// 「Threadsで許可する」を押す前の案内（specs/025-threads-account-guide contracts/ui-routes.md 1、US1・FR-001〜FR-003、モック1・2枚目）。
// 許可の画面はブラウザで threads.com にログインしているアカウントを使い、アプリから切り替えられない（research.md R1）。
import { THREADS_WEB_URL, accountGuideLead, accountSwitchSteps } from "@threads-grower/shared";
import { ExternalLinkIcon } from "lucide-react";
import { Toggle } from "@/components/settings/FeatureSwitches";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * threads.com を新しいタブで開く文字のリンク。
 * @returns リンク
 */
export function ThreadsWebLink() {
  return (
    <a className="inline-flex items-center gap-1.5 underline underline-offset-4" href={THREADS_WEB_URL} target="_blank" rel="noreferrer">
      threads.comを開く
      <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
    </a>
  );
}

/**
 * 押す前の案内。使うべきアカウントが決まっていれば@名前を太字で出し、閉じたトグルに切り替えの手順を入れる。
 * @param props - expected：使うべきアカウントのユーザー名（@なし。決まっていなければ null）
 * @returns 案内
 */
export function ThreadsAccountGuide({ expected }: { expected: string | null }) {
  const lead = accountGuideLead(null);
  return (
    // 警告ではないので、alert ではなく note にする（エラーの枠と区別する）
    <Alert role="note">
      <AlertDescription className="space-y-2 text-foreground">
        <p className="text-[13px] leading-relaxed">
          {lead}
          {expected && (
            <>
              <strong className="font-semibold">@{expected}</strong> でログインしているか確かめてください。
            </>
          )}
        </p>
        <Toggle title="違うアカウントが出たときは" region="違うアカウントが出たときの手順">
          <ul className="space-y-0.5">
            {accountSwitchSteps(expected, "Threadsで許可する").map((s) => (
              <li key={s}>・{s}</li>
            ))}
          </ul>
          <ThreadsWebLink />
        </Toggle>
      </AlertDescription>
    </Alert>
  );
}
