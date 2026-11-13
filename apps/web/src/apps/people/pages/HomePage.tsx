// 「/people」：誘う候補（ホーム）。PR1では、取り込みへの案内だけ（specs/people/001-people-memo contracts/ui-routes.md 1、tasks.md T023）。
import { FileUpIcon } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/shell";
import { importPath } from "../lib/paths";

/**
 * 誘う候補の画面（PR1は取り込みへの案内）。
 * @returns 画面
 */
export function HomePage() {
  return (
    <>
      <PageHeader title="誘う候補" />
      <PageBody>
        <section className="space-y-4 rounded-2xl border bg-card p-6 text-center">
          <h2 className="text-lg font-semibold">まずアンケートを取り込みましょう</h2>
          <p className="text-sm text-muted-foreground">
            イベントのアンケート（Googleフォームの回答のCSV）を取り込むと、会った人を覚えられます。
          </p>
          <Button asChild className="h-11 rounded-full md:h-10">
            <Link to={importPath()}>
              <FileUpIcon /> アンケートを取り込む
            </Link>
          </Button>
        </section>
      </PageBody>
    </>
  );
}
