import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { CenteredLayout } from "@/components/layout/AppShell";

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
