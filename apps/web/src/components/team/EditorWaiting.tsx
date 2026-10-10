// 担当がまだない編集者への案内（specs/008-team-operations FR-026・FR-047(3)、contracts/ui-routes.md「待機の案内」）。
// Threadsアカウントの接続は求めない。
import { useQueryClient } from "@tanstack/react-query";
import { CenteredLayout } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query";

/**
 * 待機の案内。「読み込み直す」で担当が決まっていれば、担当のAccountへ移る（`/` の振り分けが行う）。
 * @param props - partnerName：パートナーの名前
 * @returns 画面
 */
export function EditorWaiting({ partnerName }: { partnerName: string }) {
  const queryClient = useQueryClient();
  return (
    <CenteredLayout>
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold">{partnerName}さんが担当を決めるのを待っています</h1>
        <p className="text-sm text-muted-foreground">担当が決まると、ここからアカウントを開けます。</p>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.me })}
        >
          読み込み直す
        </Button>
      </div>
    </CenteredLayout>
  );
}
