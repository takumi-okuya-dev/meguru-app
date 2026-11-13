// 集金管理（apps/collect）の入口。組み立て（app.ts・index.ts・jobs/）は、集金管理をこの入口からだけ使う（docs/module-map.md 1-2・6）。
import { Hono, type MiddlewareHandler } from "hono";
import { COLLECT_APP } from "@meguru/shared";
import type { ApiAppModule, AppEnv } from "../../platform";
import { collectOwner } from "./access";
import { closingRoutes } from "./closing/closing-routes";
import { eventRoutes } from "./events/event-routes";
import { helperOwnerRoutes, helperPublicRoutes } from "./helpers/helper-routes";
import { receptionLinkTokenKeys } from "./helpers/link-tokens";
import { liveRoutes } from "./live/live-routes";
import { receptionRoutes } from "./reception/reception-routes";
import { collectMeRoutes } from "./me/collect-me";
import { rosterRoutes } from "./roster/roster-routes";
import { settingsRoutes } from "./settings/settings-routes";
import { summaryRoutes } from "./summaries/summary-routes";
import { candidateRoutes } from "./threads-candidates/candidate-routes";
import { transferRoutes } from "./transfers/transfer-routes";

import { registerCollect } from "./register";

// 会場の共有の Durable Object（組み立ての durable-objects.ts が書き出す。specs/collect/001 research.md R4）
export { CollectLiveRoom } from "./live/live-room";
import { recountCollectUsage } from "./usage/usage";

/**
 * 集金管理の道筋（/api/collect の下。specs/collect/001-event-day-collection contracts/api.md）。
 * 主催者の道筋にはどれも、ログインと集金管理の利用の許可の関所を付ける。関所の外にあるのは、手伝う人の /r/:token/…（受付用リンクと
 * 端末の印で確かめる）と、会場の共有の /live（入場券で確かめる）だけ。
 * @param authed - ログインのミドルウェア
 * @returns Hono のアプリ（app.ts が /api/collect につなぐ）
 */
function collectRoutes(authed: MiddlewareHandler<AppEnv>) {
  const owner = collectOwner(authed);
  return new Hono<AppEnv>()
    .route("/", collectMeRoutes(owner))
    .route("/", eventRoutes(owner))
    .route("/", rosterRoutes(owner))
    .route("/", settingsRoutes(owner))
    .route("/", receptionRoutes(owner))
    .route("/", helperOwnerRoutes(owner))
    .route("/", liveRoutes(owner))
    .route("/", closingRoutes(owner))
    .route("/", transferRoutes(owner))
    .route("/", summaryRoutes(owner))
    .route("/", candidateRoutes(owner))
    .route("/", helperPublicRoutes());
}

/** 集金管理の入口（組み立ての一覧 app-modules.ts が読む。specs/meguru/031-conflict-free-composition）。 */
export const collectModule: ApiAppModule = {
  id: COLLECT_APP,
  register: registerCollect,
  routes: collectRoutes,
  // 「使っているか」を数え直して伝える（料金の数はいつも0。specs/collect/001-event-day-collection）
  dailyJobs: (env) => [["collect usage recount", () => recountCollectUsage(env)]],
  // 受付用リンクのトークンは共通の鍵で暗号化して持つので、鍵の入れ替えで暗号化し直す（research.md R7）
  tokenKeys: receptionLinkTokenKeys,
};
