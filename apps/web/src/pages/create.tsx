// 「投稿をつくる」の画面（specs/014-strategy-guidance US15、FR-160〜FR-162・FR-165、contracts/ui-routes.md「投稿をつくる」）。
// 上から：5つの手順 → プロンプトのカード → 貼り付け欄。投稿ストック（/stock）は一覧だけにし、作る流れはこの画面にまとめる。
import { useQuery } from "@tanstack/react-query";
import { PROMPT_COUNT_DEFAULT } from "@threads-grower/shared";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { CreateSteps } from "@/components/create/CreateSteps";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { PasteComposer } from "@/components/stock/PasteComposer";
import { flushPendingDeletes } from "@/components/stock/use-deferred-delete";
import { PromptCard } from "@/components/stock/PromptCard";
import { STOCK_LIMIT_MESSAGE } from "@/components/stock/messages";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { featureOn, useAccountAccess } from "@/lib/use-account-access";
import { useCurrentAccount } from "@/pages/account-layout";

/**
 * 「投稿をつくる」の画面。同じURLのままAccountを切り替えたときに、プロンプトのカードの状態（使えない表示など）を
 * 持ち越さないよう、Accountごとに作り直す（PR #5 のCodexレビュー）。
 * @returns 「投稿をつくる」の画面
 */
export function CreatePage() {
  const account = useCurrentAccount();
  return <CreatePageContent key={account.id} />;
}

/**
 * 「投稿をつくる」の画面の中身（1つのAccount分）。
 * @returns 「投稿をつくる」の画面
 */
function CreatePageContent() {
  const account = useCurrentAccount();
  // 作る件数・プロンプトを作れるか・要確認の上限は、投稿ストックと同じ一覧から読む（同じキャッシュを使う）
  const drafts = useQuery({
    queryKey: queryKeys.postDrafts(account.id),
    queryFn: () => api.listPostDrafts(account.id),
  });
  const { access, can } = useAccountAccess(account.id);
  // 投稿ストックで削除して「元に戻す」を待っている下書きは、この画面を開いたときに確定する
  // （件数・上限の表示が古くならないように。PR #17 のCodexレビュー）
  useEffect(() => {
    void flushPendingDeletes();
  }, []);
  // 開くたびに変わるキー。初めのフォーカス（プロンプトの「コピー」、作れないときは貼り付け欄）に使う
  const { key: openKey } = useLocation();
  // 画面を開いた後にプロンプトが使えなくなった（無料体験の終了など）。そのときは貼り付け欄から始める
  const [promptLocked, setPromptLocked] = useState(false);
  const data = drafts.data;

  if (drafts.error) return <ApiErrorScreen error={drafts.error} onRetry={() => void drafts.refetch()} />;

  const atLimit = data ? data.needsReview.length >= data.limits.needsReview : false;
  // 手順の案内は、直せる人だけ（読むだけのときは出さない。specs/014 FR-130）
  const canCreate = !!data && data.canGeneratePrompt && !promptLocked && can("content");

  return (
    <>
      <PageHeader title="投稿をつくる" />
      <PageBody className="space-y-6 pb-16">
        {canCreate && <CreateSteps accountId={account.id} strategy={featureOn(access, "strategy")} />}
        {data ? (
          <PromptCard
            accountId={account.id}
            canGeneratePrompt={data.canGeneratePrompt}
            promptPostCount={data.promptPostCount ?? PROMPT_COUNT_DEFAULT}
            promptPostCountVersion={data.promptPostCountVersion ?? 1}
            canSaveCount={can("settings")}
            startKey={openKey}
            onLocked={() => setPromptLocked(true)}
          />
        ) : (
          <div className="h-32 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
        )}
        {atLimit && (
          <p role="status" className="rounded-xl border border-warning/40 bg-warning-bg px-4 py-3 text-sm">
            {STOCK_LIMIT_MESSAGE}
          </p>
        )}
        <PasteComposer
          accountId={account.id}
          atLimit={atLimit}
          focusKey={data && (!data.canGeneratePrompt || promptLocked) ? openKey : undefined}
        />
      </PageBody>
    </>
  );
}
