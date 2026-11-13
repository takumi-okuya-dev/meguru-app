// 人物メモの入口（specs/people/001-people-memo contracts/ui-routes.md、specs/028-meguru-shell data-model.md 4）。
// 外枠と組み立ては、人物メモをここからだけ読む。
import { ContactIcon } from "lucide-react";
import { defineWithdrawalPreview, type AppModule } from "@/shell";
import { PeopleWithdrawalPreviewSection } from "./components/WithdrawalPreviewSection";
import { peopleApi } from "./lib/api";
import { importPath, PEOPLE_BASE } from "./lib/paths";
import { peopleQueryKeys } from "./lib/query-keys";
import { peopleRoutes } from "./routes";

/** 人物メモのアプリ。 */
export const peopleApp: AppModule = {
  id: "people",
  basePath: PEOPLE_BASE,
  icon: ContactIcon,
  startPath: importPath(),
  routes: peopleRoutes,
  // 退会の確かめで「人物メモ：人 n人・イベント n件が消えます」を出す（research.md R19）
  withdrawalPreview: defineWithdrawalPreview({
    query: { queryKey: peopleQueryKeys.withdrawalPreview, queryFn: peopleApi.me },
    Section: PeopleWithdrawalPreviewSection,
  }),
};
