import { defineConfig } from "drizzle-kit";
import { loadWorktreeEnv } from "./scripts/worktree-env";

// マイグレーションの生成と適用。適用先は DATABASE_URL_DIRECT（Postgres に直接つなぐURL）。
// ローカルの既定値は docker compose の Postgres（作業場所を分けているときは、その作業場所のDB。scripts/worktree-env.ts）。
loadWorktreeEnv();
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT ?? "postgres://postgres:postgres@localhost:5432/threads_grower",
  },
});
