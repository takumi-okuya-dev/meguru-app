// 使えない機能を開いたときの案内（specs/019-feature-switches contracts/ui-routes.md 3、FR-006）。
// 理由や料金の案内は出さない（プランが決まってから足す）。戻る先は、引数か、画面の枠が渡した「ホームへ」の戻る先（lib/home-link）。
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useHomeLink } from "@/lib/home-link";

/**
 * 「この機能は今は使えません」と、ホームへ戻る道だけを出す。
 * @param props - homeTo：ホームへ戻る先（省略すると、画面の枠が渡した戻る先）
 * @returns 使えない機能の案内
 */
export function FeatureUnavailableNotice({ homeTo }: { homeTo?: string }) {
  const fallback = useHomeLink();
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-16 text-center" role="alert">
      <h1 className="text-lg font-semibold">この機能は今は使えません</h1>
      <Button asChild variant="outline" className="h-10 rounded-full md:h-9">
        <Link to={homeTo ?? fallback}>ホームへ</Link>
      </Button>
    </div>
  );
}
