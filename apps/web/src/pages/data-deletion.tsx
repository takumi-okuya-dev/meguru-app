// Metaのデータ削除要求の状況表示（research.md R7）。failed は「処理中」として表示する
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { CenteredLayout } from "@/components/layout/AppShell";
import { api } from "@/lib/api-client";

export function DataDeletion() {
  const { code } = useParams<{ code: string }>();
  const status = useQuery({
    queryKey: ["data-deletion", code],
    queryFn: () => api.dataDeletionStatus(code!),
    enabled: Boolean(code),
  });

  let body: string;
  if (status.isPending) body = "確認しています…";
  else if (status.isError) body = "この確認コードの要求は見つかりませんでした。";
  else if (status.data.status === "completed" && status.data.completedAt) {
    body = `削除が完了しました（${new Date(status.data.completedAt).toLocaleString("ja-JP")}）。`;
  } else body = "データ削除の要求を受け付け、処理しています。";

  return (
    <CenteredLayout>
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold">データ削除の状況</h1>
        <p className="text-sm text-muted-foreground">確認コード：{code}</p>
        <p>{body}</p>
      </div>
    </CenteredLayout>
  );
}
