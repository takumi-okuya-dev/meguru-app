// 集金管理（apps/collect）の入口。組み立て（app.ts・index.ts・jobs/）は、集金管理をこの入口からだけ使う（docs/module-map.md 1-2・6）。
import { Hono, type MiddlewareHandler } from "hono";
import { COLLECT_APP } from "@meguru/shared";
import type { ApiAppModule, AppEnv } from "../../platform";
import { collectOwner } from "./access";
import { eventRoutes } from "./events/event-routes";
import { collectMeRoutes } from "./me/collect-me";
import { rosterRoutes } from "./roster/roster-routes";
import { settingsRoutes } from "./settings/settings-routes";

import { registerCollect } from "./register";
import { recountCollectUsage } from "./usage/usage";

/**
 * 集金管理の主催者の道筋（/api/collect の下。specs/collect/001-event-day-collection contracts/api.md 1〜3・7）。
 * どの道筋にも、ログインと集金管理の利用の許可の関所を付ける（手伝う人のログインのいらない道筋は PR2 で別に足す）。
 * @param authed - ログインのミドルウェア
 * @returns Hono のアプリ（app.ts が /api/collect につなぐ）
 */
function collectRoutes(authed: MiddlewareHandler<AppEnv>) {
  const owner = collectOwner(authed);
  return new Hono<AppEnv>()
    .route("/", collectMeRoutes(owner))
    .route("/", eventRoutes(owner))
    .route("/", rosterRoutes(owner))
    .route("/", settingsRoutes(owner));
}

/** 集金管理の入口（組み立ての一覧 app-modules.ts が読む。specs/meguru/031-conflict-free-composition）。 */
export const collectModule: ApiAppModule = {
  id: COLLECT_APP,
  register: registerCollect,
  routes: collectRoutes,
  // 「使っているか」を数え直して伝える（料金の数はいつも0。specs/collect/001-event-day-collection）
  dailyJobs: (env) => [["collect usage recount", () => recountCollectUsage(env)]],
};
