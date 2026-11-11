// 出せるアプリの一覧（組み立て。specs/028-meguru-shell research.md R3・R7、contracts/web-module-boundaries.md 5）。
// アプリを足すときは、ここに1行足す（外枠のほかの場所は直さない）。@meguru/shared のアプリの一覧で released のアプリだけを登録する。
import { appById } from "@meguru/shared";
import { threadsApp } from "@/apps/threads";
import type { AppModule } from "@/shell";

/** 作ったアプリの入口（出すかどうかは released で決める）。 */
const allApps: readonly AppModule[] = [threadsApp];

/** 出せるアプリの入口。 */
export const registeredApps: readonly AppModule[] = allApps.filter((a) => appById(a.id)?.released === true);
