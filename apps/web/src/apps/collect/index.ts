// 集金管理の入口（specs/collect/001-event-day-collection contracts/ui-routes.md、tasks.md T007）。外枠と組み立ては、集金管理をここからだけ読む。
import { WalletIcon } from "lucide-react";
import type { AppModule } from "@/shell";
import { COLLECT_BASE, newEventPath } from "./lib/paths";
import { collectRoutes } from "./routes";

/** 集金管理のアプリ。 */
export const collectApp: AppModule = {
  id: "collect",
  basePath: COLLECT_BASE,
  icon: WalletIcon,
  startPath: newEventPath(),
  routes: collectRoutes,
};
