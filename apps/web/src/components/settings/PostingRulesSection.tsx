// 「このアカウントの設定」の「投稿のルール」の区分（specs/004-review-approval FR-031、contracts/ui-routes.md）。
// 見た目は docs/ui-design.md 型D の右側（小見出し、角の丸い枠、枠の中を線で区切った行）にそろえる。
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { NgWordsDialog } from "./NgWordsDialog";
import { SettingCard, SettingRow } from "./SettingRow";

type Open = "ng-words" | null;

/**
 * 「投稿のルール」の区分。NGワードの行（US2）。
 * @param props - accountId：Account の ID
 * @returns 区分
 */
export function PostingRulesSection({ accountId }: { accountId: string }) {
  const rules = useQuery({ queryKey: queryKeys.postingRules(accountId), queryFn: () => api.getPostingRules(accountId) });
  const [open, setOpen] = useState<Open>(null);
  const data = rules.data;

  return (
    <section aria-labelledby="posting-rules-heading" className="space-y-3">
      <h2 id="posting-rules-heading" className="font-medium">
        投稿のルール
      </h2>
      {rules.isError ? (
        <p className="text-sm text-muted-foreground">
          読み込めませんでした。{" "}
          <button type="button" className="text-ring underline" onClick={() => void rules.refetch()}>
            再読み込み
          </button>
        </p>
      ) : (
        <SettingCard>
          <SettingRow
            label="NGワード"
            description={`この言葉を含む下書きは承認できません。${data ? `${data.ngWords.length}語` : ""}`}
          >
            <Button variant="outline" className="h-10 rounded-full md:h-9" disabled={!data} onClick={() => setOpen("ng-words")}>
              編集
            </Button>
          </SettingRow>
        </SettingCard>
      )}
      {open === "ng-words" && data && <NgWordsDialog accountId={accountId} ngWords={data.ngWords} onClose={() => setOpen(null)} />}
    </section>
  );
}
