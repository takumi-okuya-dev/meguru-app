// アプリの一覧（組み立て。specs/meguru/031-conflict-free-composition）。登録・道筋・毎日の処理は、この一覧を platform の関数が回す。
// アプリを足すときは、ここに import を1行と、一覧に1行を足すだけにする（app.ts・index.ts・jobs/daily-jobs.ts は直さない）。
// このファイルは .gitattributes で merge=union にしてある：2つのブランチが同時に1行ずつ足しても、両方の行が残る。
// そのため import と一覧のほかは置かず、1行に1つだけ書く（docs/parallel-development.md 11）。
import type { ApiAppModule } from "./platform";
import { threadsModule } from "./apps/threads";
import { collectModule } from "./apps/collect";
import { peopleModule } from "./apps/people";

/** API のアプリの一覧（登録・道筋・毎日の処理の順）。 */
// prettier-ignore
export const API_APPS: readonly ApiAppModule[] = [
  threadsModule,
  collectModule,
  peopleModule,
];
