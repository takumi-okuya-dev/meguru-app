// 集金管理（apps/collect）の入口。組み立て（app.ts・index.ts・jobs/）は、集金管理をこの入口からだけ使う（docs/module-map.md 1-2・6）。
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../platform";
import { collectOwner } from "./access";
import { eventRoutes } from "./events/event-routes";
import { collectMeRoutes } from "./me/collect-me";
import { rosterRoutes } from "./roster/roster-routes";
import { settingsRoutes } from "./settings/settings-routes";

export { registerCollect } from "./register";
export { recountCollectUsage } from "./usage/usage";

/**
 * 集金管理の主催者の道筋（/api/collect の下。specs/collect/001-event-day-collection contracts/api.md 1〜3・7）。
 * どの道筋にも、ログインと集金管理の利用の許可の関所を付ける（手伝う人のログインのいらない道筋は PR2 で別に足す）。
 * @param authed - ログインのミドルウェア
 * @returns Hono のアプリ（app.ts が /api/collect につなぐ）
 */
export function collectRoutes(authed: MiddlewareHandler<AppEnv>) {
  const owner = collectOwner(authed);
  return new Hono<AppEnv>()
    .route("/", collectMeRoutes(owner))
    .route("/", eventRoutes(owner))
    .route("/", rosterRoutes(owner))
    .route("/", settingsRoutes(owner));
}
