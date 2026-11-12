// API の開発サーバー（pnpm dev・pnpm dev:fake）。作業場所ごとのポートのずらし幅（.env.worktree。scripts/worktree-env.ts）を足して
// wrangler dev を起動する。ずらし幅がなければ、今までどおり 8787（デバッガーは 9229）。
// --fake-threads を付けると、Threads を偽のThreadsサーバー（pnpm fake-threads。8790）に向ける。ほかの引数は、そのまま wrangler dev に渡す。
import { spawn } from "node:child_process";
import { loadWorktreeEnv } from "./worktree-env";

const { portOffset } = loadWorktreeEnv();
const api = 8787 + portOffset;
const fakeThreads = 8790 + portOffset;
const rest = process.argv.slice(2);
const fake = rest.includes("--fake-threads");
const args = [
  "dev",
  "--port",
  String(api),
  "--inspector-port",
  String(9229 + portOffset),
  ...(fake
    ? [
        "--var",
        `THREADS_AUTH_BASE_URL:http://localhost:${fakeThreads}`,
        "--var",
        `THREADS_GRAPH_BASE_URL:http://localhost:${fakeThreads}`,
        "--var",
        `THREADS_REDIRECT_URI:http://localhost:${api}/api/threads/callback`,
      ]
    : []),
  ...rest.filter((a) => a !== "--fake-threads"),
];
const child = spawn("wrangler", args, { stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
