// 人物メモの入口（specs/people/001-people-memo contracts/ui-routes.md、specs/028-meguru-shell data-model.md 4）。
// 外枠と組み立ては、人物メモをここからだけ読む。
import { ContactIcon } from "lucide-react";
import { defineWithdrawalPreview, type AppModule } from "@/shell";
import { PeopleWithdrawalPreviewSection } from "./components/WithdrawalPreviewSection";
import { peopleApi } from "./lib/api";
import { importPath, PEOPLE_BASE } from "./lib/paths";
import { peopleQueryKeys } from "./lib/query-keys";
import { peopleRoutes } from "./routes";
import { ApiError } from "@/lib/api-client";
import type { PeopleMe } from "@meguru/shared/people";

/**
 * 退会の確かめの中身を読む。人物メモを開いていない人（403 APP_NOT_AVAILABLE）は人物メモのデータを持たないので、
 * 出すものなし（null）にする。失敗にすると、外枠の退会のダイアログが退会のボタンを押せなくなる（PR #111 のセルフレビュー）。
 * @returns 人とイベントの数。使えない人は null
 */
async function peopleWithdrawalPreview(): Promise<PeopleMe | null> {
  try {
    return await peopleApi.me();
  } catch (err) {
    if (err instanceof ApiError && err.code === "APP_NOT_AVAILABLE") return null;
    throw err;
  }
}

/** 人物メモのアプリ。 */
export const peopleApp: AppModule = {
  id: "people",
  basePath: PEOPLE_BASE,
  icon: ContactIcon,
  startPath: importPath(),
  routes: peopleRoutes,
  // 退会の確かめで「人物メモ：人 n人・イベント n件が消えます」を出す（research.md R19）
  withdrawalPreview: defineWithdrawalPreview({
    query: { queryKey: peopleQueryKeys.withdrawalPreview, queryFn: peopleWithdrawalPreview },
    Section: PeopleWithdrawalPreviewSection,
  }),
};
