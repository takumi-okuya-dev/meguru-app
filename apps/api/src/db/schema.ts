// 表の定義の一覧（組み立て。docs/module-map.md 2-5）。drizzle-kit とテストはこのファイルを読む。
// 表の定義そのものは、持ち主のモジュールの schema.ts にある（共通：platform/schema.ts、Threads：apps/threads/schema.ts、人物メモ：apps/people/schema.ts）。
export * from "../platform/schema";
export * from "../apps/threads/schema";
export * from "../apps/people/schema";
