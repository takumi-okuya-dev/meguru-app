// 人物メモの利用の許可がない人に出す画面（specs/people/001-people-memo contracts/ui-routes.md 1、specs/meguru/030）。
// /api/me の available に people がない、または人物メモのAPIが 403 APP_NOT_AVAILABLE を返したときに出す。
import { errorMessage } from "@meguru/shared";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { CenteredLayout } from "@/shell";

/**
 * 「このアプリは今は使えません」と、すべてのアプリへ戻る道だけを出す（理由や申し込みの案内は出さない）。
 * @returns 使えないアプリの案内
 */
export function PeopleUnavailable() {
  return (
    <CenteredLayout>
      <div className="flex flex-col items-center gap-4 text-center" role="alert">
        <h1 className="text-lg font-semibold">{errorMessage("APP_NOT_AVAILABLE").message}</h1>
        <Button asChild variant="outline" className="h-11 rounded-full md:h-9">
          <Link to="/apps">すべてのアプリへ</Link>
        </Button>
      </div>
    </CenteredLayout>
  );
}
