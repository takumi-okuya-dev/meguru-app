// アプリの一覧（catalog.ts）と、アプリごとの共通の型。specs/meguru/029-threads-pattern1 tasks.md T021。
// 人物メモのように、`@meguru/shared/<アプリ>` から読ませるアプリは、ここに足さない（package.json の exports に足す）。
// このファイルは .gitattributes で merge=union にしてある：1行に1つだけ書き、ほかの中身を足さない（docs/parallel-development.md 11）。
export * from "./catalog";
export * from "./threads";
export * from "./collect";
