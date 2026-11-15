// 作ったアプリの入口の一覧（組み立て。specs/meguru/031-conflict-free-composition）。出すかどうかは app-registry.ts が released で決める。
// アプリを足すときは、ここに import を1行と、一覧に1行を足すだけにする（外枠のほかの場所は直さない）。
// このファイルは .gitattributes で merge=union にしてある：1行に1つだけ書き、ほかの中身を足さない（docs/parallel-development.md 11）。
import type { AppModule } from "@/shell";
import { threadsApp } from "@/apps/threads";
import { collectApp } from "@/apps/collect";
import { peopleApp } from "@/apps/people";

/** 作ったアプリの入口。 */
// prettier-ignore
export const ALL_APPS: readonly AppModule[] = [
  threadsApp,
  collectApp,
  peopleApp,
];
