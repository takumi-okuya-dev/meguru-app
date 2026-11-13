// 表の定義の一覧（組み立て。docs/module-map.md 2-5）。drizzle-kit とテストはこのファイルを読む。
// 表の定義そのものは、持ち主のモジュールの schema.ts にある。アプリを足すときは、ここに1行足すだけにする。
// このファイルは .gitattributes で merge=union にしてある：1行に1つだけ書き、ほかの中身を足さない（docs/parallel-development.md 11）。
export * from "../platform/schema";
export * from "../apps/threads/schema";
export * from "../apps/collect/schema";
export * from "../apps/people/schema";
