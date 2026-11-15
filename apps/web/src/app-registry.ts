// 出せるアプリの一覧（組み立て。specs/028-meguru-shell research.md R3・R7、contracts/web-module-boundaries.md 5）。
// アプリを足すときは app-list.ts に1行足す（ここと外枠のほかの場所は直さない。specs/meguru/031）。@meguru/shared のアプリの一覧で released のアプリだけを登録する。
import { appById } from "@meguru/shared";
import { ALL_APPS } from "@/app-list";
import type { AppModule } from "@/shell";

/** 出せるアプリの入口。 */
export const registeredApps: readonly AppModule[] = ALL_APPS.filter((a) => appById(a.id)?.released === true);
