// ルーター（組み立て。specs/028-meguru-shell research.md R3）。外枠の buildRoutes に、出せるアプリの一覧を渡して組む。
import { createBrowserRouter } from "react-router";
import { registeredApps } from "@/app-registry";
import { buildRoutes } from "@/shell";

/** 画面のルート（contracts/ui-routes.md「ルート」）。 */
export const routes = buildRoutes(registeredApps);

/** アプリのルーター。 */
export const router = createBrowserRouter(routes);
