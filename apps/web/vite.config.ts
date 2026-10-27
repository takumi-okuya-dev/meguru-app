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

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), noindexOnStaging(loadEnv(mode, import.meta.dirname, "VITE_").VITE_APP_ENV)],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
}));
