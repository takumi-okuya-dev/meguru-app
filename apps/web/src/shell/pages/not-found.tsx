import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { CenteredLayout } from "@/shell/layout/AppShell";

/**
 * 404 画面。「自分のAccountへ戻る」リンクを置く。
 * @param props - message：補足の説明
 * @returns 404 画面
 */
export function NotFound({ message }: { message?: string }) {
  return (
    <CenteredLayout>
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">ページが見つかりません</h1>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        <Button asChild>
          <Link to="/">自分のAccountへ戻る</Link>
        </Button>
      </div>
    </CenteredLayout>
  );
}
