// Threadsの入口（specs/028-meguru-shell data-model.md 4、contracts/web-module-boundaries.md 1）。外枠と組み立ては、Threadsをここからだけ読む。
import { createElement } from "react";
import { AtSignIcon, ListIcon, MailPlusIcon } from "lucide-react";
import type { AppModule } from "@/shell";
import { OperatorAccountsPage } from "./pages/settings/operator-accounts";
import { TesterInvitesPage } from "./pages/settings/tester-invites";
import { newAccountPath, THREADS_BASE } from "./lib/paths";
import { threadsPublicRoutes, threadsReadingRoutes, threadsRoutes } from "./routes";

/** Threadsのアプリ。 */
export const threadsApp: AppModule = {
  id: "threads",
  basePath: THREADS_BASE,
  icon: AtSignIcon,
  startPath: newAccountPath(),
  routes: threadsRoutes,
  publicRoutes: threadsPublicRoutes,
  readingRoutes: threadsReadingRoutes,
  // 前のURL（/accounts/…・/teams/…）は /threads の下へ移す（specs/028 contracts/ui-routes.md 2）
  legacyRedirects: [
    { from: "/accounts", to: `${THREADS_BASE}/accounts` },
    { from: "/teams", to: `${THREADS_BASE}/teams` },
  ],
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
