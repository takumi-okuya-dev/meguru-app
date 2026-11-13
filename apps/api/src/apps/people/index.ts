// 人物メモ（apps/people）の入口（docs/module-map.md 6章、specs/people/001-people-memo plan.md）。
// 組み立て（app-modules.ts）は、この入口の peopleModule を読む。
import type { ApiAppModule } from "../../platform";
import { registerPeople } from "./register";
import { PEOPLE_APP } from "./registry";
import { peopleRoutes } from "./routes";

export { registerPeople, peopleRoutes, PEOPLE_APP };

/** 人物メモの入口（組み立ての一覧 app-modules.ts が読む。specs/meguru/031-conflict-free-composition）。 */
export const peopleModule: ApiAppModule = {
  id: PEOPLE_APP,
  register: registerPeople,
  routes: peopleRoutes,
};
