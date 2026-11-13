// /api/people の道筋（specs/people/001-people-memo contracts/api.md 0）。すべての道筋は、ログインのあと
// アプリの利用の許可の関所（requireAppAccess("people")）を通る。使えない人は 403 APP_NOT_AVAILABLE。
import { Hono, type MiddlewareHandler } from "hono";
import { requireAppAccess, type AppEnv } from "../../platform";
import { eventRoutes } from "./events/event-routes";
import { importRoutes } from "./imports/import-routes";
import { peopleMeRoutes } from "./me/me-routes";
import { personRoutes } from "./persons/person-routes";
import { PEOPLE_APP } from "./registry";

/**
 * 人物メモの道筋（組み立てが /api/people につなぐ）。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function peopleRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .use("*", authed, requireAppAccess(PEOPLE_APP))
    .route("/", peopleMeRoutes())
    .route("/", eventRoutes())
    .route("/", importRoutes())
    .route("/", personRoutes());
}
