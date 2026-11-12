// 退会の確かめのThreadsの分（specs/013 contracts/ui-routes.md「退会」、specs/meguru/029 tasks.md T052）。
// 外枠の退会のダイアログに、AppModule の withdrawalPreview として渡す。見た目と文言は、ダイアログに直接書いていたときのまま。
import type { ThreadsWithdrawalPreview } from "@meguru/shared";

/**
 * チームの行き先の文。
 * @param t - チーム
 * @returns 文
 */
function teamLine(t: ThreadsWithdrawalPreview["teams"][number]): string {
  if (t.outcome === "transfer") return `${t.name}：${t.nextAdminName ?? "ほかの人"}さんに管理者を引き継ぎます`;
  if (t.outcome === "delete") return `${t.name}：チームを削除します`;
  return `${t.name}：チームから外れます`;
}

/**
 * 消えるアカウントと、チームの行き先。
 * @param props - data：GET /api/threads/me/withdrawal-preview の中身
 * @returns 退会のダイアログに出す部分
 */
export function ThreadsWithdrawalPreviewSection({ data }: { data: unknown }) {
  const p = data as ThreadsWithdrawalPreview;
  return (
    <>
      <section className="space-y-1">
        <h3 className="font-medium">消えるもの</h3>
        {p.ownedAccounts.length > 0 ? (
          <>
            <p>
              あなたのアカウント（{p.ownedAccounts.length}件）：{p.ownedAccounts.map((a) => a.name).join("、")}
            </p>
            <p className="text-muted-foreground">戦略・投稿ストック・設定・パフォーマンス・Threadsとのつながり・予約中の自動投稿</p>
          </>
        ) : (
          <p>あなたのアカウントはありません</p>
        )}
      </section>
      {p.teams.length > 0 && (
        <section className="space-y-1">
          <h3 className="font-medium">チーム</h3>
          <ul className="list-disc pl-5">
            {p.teams.map((t) => (
              <li key={t.id}>{teamLine(t)}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
