// 「このアカウントの設定」の「投稿のルール」の区分（specs/004-review-approval FR-031、contracts/ui-routes.md）。
// 見た目は docs/ui-design.md 型D の右側（小見出し、角の丸い枠、枠の中を線で区切った行）にそろえる。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { CoreRulesDialog } from "./CoreRulesDialog";
import { NgWordsDialog } from "./NgWordsDialog";
import { PolicyInfoDialog } from "./PolicyInfoDialog";
import { SettingCard, SettingRow } from "./SettingRow";

type Open = "ng-words" | "core-rules" | "policy" | null;

/**
 * 投稿ルールの空でない行の数。
 * @param text - 投稿ルール
 * @returns 行の数
 */
const ruleCount = (text: string) => text.split("\n").filter((l) => l.trim() !== "").length;

/**
 * 「投稿のルール」の区分。NGワードの行（US2）、投稿ルールの行（US4）、Threadsの規約への備えの行（US5）。
 * @param props - accountId：Account の ID、canEdit：設定の権限（ないときは読むだけ。specs/008 FR-041）
 * @returns 区分
 */
export function PostingRulesSection({ accountId, canEdit = true }: { accountId: string; canEdit?: boolean }) {
  const rules = useQuery({
    queryKey: queryKeys.postingRules(accountId),
    queryFn: () => api.getPostingRules(accountId),
  });
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Open>(null);
  const data = rules.data;

  return (
    <section aria-labelledby="posting-rules-heading" className="space-y-3">
      <h2 id="posting-rules-heading" className="font-medium">
        投稿のルール
      </h2>
      {!canEdit && <p className="text-xs text-muted-foreground">変更できるのはオーナーです</p>}
      {rules.isError ? (
        <p className="text-sm text-muted-foreground">
          読み込めませんでした。{" "}
          <button
            type="button"
            className="text-ring underline"
            onClick={() => void rules.refetch()}
          >
            再読み込み
          </button>
        </p>
      ) : (
        <SettingCard>
          <SettingRow
            label="NGワード"
            description={`この言葉を含む下書きは承認できません。${data ? `${data.ngWords.length}語` : ""}`}
          >
            {canEdit && (
              <Button
                variant="outline"
                className="h-10 rounded-full md:h-9"
                disabled={!data}
                onClick={() => setOpen("ng-words")}
              >
                編集
              </Button>
            )}
          </SettingRow>
          <SettingRow
            label="投稿ルール（CORE RULES）"
            description={`AIプロンプトに「絶対に守るルール」として入ります。${
              data
                ? ruleCount(data.coreRules) > 0
                  ? `${ruleCount(data.coreRules)}件`
                  : "未入力"
                : ""
            }`}
          >
            <Button
              variant="outline"
              className="h-10 rounded-full md:h-9"
              disabled={!data}
              onClick={() => setOpen("core-rules")}
            >
              {data && (!data.canEditCoreRules || !canEdit) ? "見る" : "編集"}
            </Button>
          </SettingRow>
          <SettingRow
            label="Threadsの規約への備え"
            description="規約に触れやすい表現に「規約に注意」と表示し、プロンプトにルールを入れます"
          >
            <Button
              variant="outline"
              className="h-10 rounded-full md:h-9"
              onClick={() => setOpen("policy")}
            >
              見る
            </Button>
          </SettingRow>
        </SettingCard>
      )}
      {open === "policy" && <PolicyInfoDialog onClose={() => setOpen(null)} />}
      {open === "core-rules" && data && (
        <CoreRulesDialog
          accountId={accountId}
          coreRules={data.coreRules}
          version={data.coreRulesVersion}
          readOnly={!data.canEditCoreRules || !canEdit}
          onSaved={() => {
            setOpen(null);
            void queryClient.invalidateQueries({ queryKey: queryKeys.postingRules(accountId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.promptAll(accountId) });
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "ng-words" && data && (
        <NgWordsDialog accountId={accountId} ngWords={data.ngWords} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}
