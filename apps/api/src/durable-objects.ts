// Durable Object の一覧（組み立て。Workers の入口 index.ts が `export *` で書き出す。wrangler.toml の class_name と同じ名前）。
// アプリの Durable Object を足すときは、ここに1行足すだけにする（index.ts は直さない）。
// このファイルは .gitattributes で merge=union にしてある：1行に1つだけ書き、ほかの中身を足さない（docs/parallel-development.md 11）。
export { CollectLiveRoom } from "./apps/collect";
