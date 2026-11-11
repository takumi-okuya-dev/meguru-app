// 出せるアプリの一覧（組み立て。specs/028-meguru-shell research.md R3、contracts/web-module-boundaries.md 5）。
// アプリを足すときは、ここに1行足す（外枠のほかの場所は直さない）。
import { threadsApp } from "@/apps/threads";
import type { AppModule } from "@/shell";

/** 出せるアプリの入口。 */
export const registeredApps: readonly AppModule[] = [threadsApp];
