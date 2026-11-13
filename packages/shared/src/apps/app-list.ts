// アプリの一覧（specs/028-meguru-shell data-model.md 2・specs/meguru/031-conflict-free-composition）。並びは、すべてのアプリの画面とアプリの切り替えの順。
// アプリを足すときは、アプリのフォルダーに catalog-entry.ts を置き、ここに import を1行と、一覧に1行を足すだけにする。
// このファイルは .gitattributes で merge=union にしてある：1行に1つだけ書き、ほかの中身を足さない（docs/parallel-development.md 11）。
import type { AppCatalogEntry } from "./catalog";
import { THREADS_CATALOG_ENTRY } from "./threads/catalog-entry";
import { COLLECT_CATALOG_ENTRY } from "./collect/catalog-entry";
import { PEOPLE_CATALOG_ENTRY } from "./people/catalog-entry";

/** アプリの一覧。 */
// prettier-ignore
export const APP_CATALOG = [
  THREADS_CATALOG_ENTRY,
  COLLECT_CATALOG_ENTRY,
  PEOPLE_CATALOG_ENTRY,
] as const satisfies readonly AppCatalogEntry[];
