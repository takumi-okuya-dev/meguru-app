// 人物メモ（apps/people）の入口（docs/module-map.md 6章、specs/people/001-people-memo plan.md）。
// 組み立て（app.ts・index.ts・jobs/）は、この入口から読む。
export { registerPeople } from "./register";
export { peopleRoutes } from "./routes";
export { PEOPLE_APP } from "./registry";
