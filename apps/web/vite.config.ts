import { readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * ステージングのページを検索に載せない（specs/015 FR-042、contracts/ui-routes.md 2）。
 * `VITE_APP_ENV`が`staging`のときだけ、index.html に noindex の指定を差し込む。
 * @param appEnv - VITE_APP_ENV の値
 * @returns Vite のプラグイン
 */
function noindexOnStaging(appEnv: string | undefined): Plugin {
  return {
    name: "noindex-on-staging",
    transformIndexHtml(html) {
      if (appEnv !== "staging") return html;
      return html.replace("</head>", '  <meta name="robots" content="noindex, nofollow" />\n  </head>');
    },
  };
}

/**
 * 開発サーバーのポート。作業場所を分けているとき（リポジトリのルートの .env.worktree。apps/api/scripts/worktree-env.ts）は、
 * そのずらし幅を 5173 に足す。ファイルがなければ 5173。
 * @returns ポート
 */
function devPort(): number {
  try {
    const text = readFileSync(path.resolve(import.meta.dirname, "../../.env.worktree"), "utf8");
    const offset = Number(/^\s*MEGURU_PORT_OFFSET\s*=\s*(\d+)\s*$/m.exec(text)?.[1] ?? 0);
    return 5173 + offset;
  } catch {
    return 5173;
  }
}

export default defineConfig(({ mode }) => ({
  // 決まったポートが使われていたら、別のポートに逃げずに止める（作業場所どうしで取り違えないため）
  server: { port: devPort(), strictPort: true },
  plugins: [react(), tailwindcss(), noindexOnStaging(loadEnv(mode, import.meta.dirname, "VITE_").VITE_APP_ENV)],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
}));
