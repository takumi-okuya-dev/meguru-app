// Threadsの入口（specs/028-meguru-shell data-model.md 4、contracts/web-module-boundaries.md 1）。外枠と組み立ては、Threadsをここからだけ読む。
import { createElement } from "react";
import { ListIcon, MailPlusIcon } from "lucide-react";
import type { AppModule } from "@/shell";
import { OperatorAccountsPage } from "./pages/settings/operator-accounts";
import { TesterInvitesPage } from "./pages/settings/tester-invites";
import { threadsPublicRoutes, threadsReadingRoutes, threadsRoutes } from "./routes";

/** Threadsのアプリ。 */
export const threadsApp: AppModule = {
  id: "threads",
  basePath: "/threads",
  routes: threadsRoutes,
  publicRoutes: threadsPublicRoutes,
  readingRoutes: threadsReadingRoutes,
  settingsSections: [
    // テスター招待（specs/024 contracts/ui-routes.md 5）。運営の「グループ」の後
    {
      group: "operator",
      order: 30,
      slug: "tester-invites",
      label: "テスター招待",
      Icon: MailPlusIcon,
      keywords: ["テスター", "招待", "Meta", "申し込み", "運営"],
      element: createElement(TesterInvitesPage),
    },
    // アカウント一覧（specs/026 contracts/ui-routes.md 1）。「個人設定」の「アカウント」と分ける
    {
      group: "operator",
      order: 40,
      slug: "operator-accounts",
      label: "アカウント一覧",
      Icon: ListIcon,
      keywords: ["アカウント", "Threads", "接続", "トークン", "テスター", "運営"],
      element: createElement(OperatorAccountsPage),
    },
  ],
};
