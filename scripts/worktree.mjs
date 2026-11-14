// 手元で作業場所（git worktree）を分けて、アプリを同時に進めるためのスクリプト（README「手元で同時に進める」、docs/product-structure.md 6）。
//
//   pnpm worktree:new <名前> [ブランチ]   作業場所を作る（例：pnpm worktree:new memo feature/memo-001-contacts）
//   pnpm worktree:list                    作業場所の一覧（DBの名前とポート）
//   pnpm worktree:remove <名前>           作業場所を片付ける（作業場所とそのDBを消す。ブランチは残す）
//   pnpm worktree:reset-db --yes          今いる作業場所のDBを空から作り直し、マイグレーションを当て直す
//                                         （マイグレーションを作り直したあとなど。docs/parallel-development.md 6）
//
// 作業場所ごとに、ローカルのDB（同じ Postgres の中の threads_grower_<名前>）とポート（決まったポートに100ずつ足す）を分ける。
// 値はその作業場所のルートの .env.worktree に置き、API・Web・E2E がそれを読む（apps/api/scripts/worktree-env.ts）。
import { execFileSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const PORT_STEP = 100;
const MAX_WORKTREES = 9;

/**
 * コマンドを動かす。失敗したら止める。
 * @param {string} cmd - コマンド
 * @param {string[]} args - 引数
 * @param {{ cwd?: string, capture?: boolean }} [opts] - 動かす場所と、出力を受け取るか
 * @returns {string} 出力（capture のとき）
 */
function run(cmd, args, opts = {}) {
  const out = execFileSync(cmd, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  return opts.capture ? out.trim() : "";
}

/**
 * 作業場所の一覧。最初のものが、もとの作業場所。
 * @returns {{ path: string, branch: string }[]} 作業場所
 */
function worktrees() {
  const out = run("git", ["worktree", "list", "--porcelain"], { capture: true });
  return out
    .split("\n\n")
    .map((block) => ({
      path: /^worktree (.+)$/m.exec(block)?.[1] ?? "",
      branch: (/^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? "(detached)").trim(),
    }))
    .filter((w) => w.path);
}

/**
 * 作業場所の .env.worktree を読む。
 * @param {string} path - 作業場所
 * @returns {{ dbName: string, portOffset: number }} 値（ファイルがなければ、もとの作業場所と同じ値）
 */
function readWorktreeEnv(path) {
  try {
    const text = readFileSync(join(path, ".env.worktree"), "utf8");
    return {
      dbName: /^MEGURU_DB_NAME=(.+)$/m.exec(text)?.[1]?.trim() ?? "threads_grower",
      portOffset: Number(/^MEGURU_PORT_OFFSET=(\d+)$/m.exec(text)?.[1] ?? 0),
    };
  } catch {
    return { dbName: "threads_grower", portOffset: 0 };
  }
}

/**
 * 手元の設定ファイルの KEY=… の行を書き換える（なければ足す）。
 * @param {string} text - ファイルの中身
 * @param {string} key - 名前
 * @param {string} value - 値
 * @returns {string} 書き換えた中身
 */
function setVar(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(text)
    ? text.replace(re, `${key}=${value}`)
    : `${text.replace(/\n?$/, "\n")}${key}=${value}\n`;
}

/**
 * ローカルの Postgres に SQL を流す（docker compose の postgres。名前を決めてあるので、どの作業場所からでも同じコンテナ）。
 * @param {string} main - もとの作業場所
 * @param {string} sql - SQL
 * @returns {string} 出力
 */
function psql(main, sql) {
  const compose = join(main, "docker-compose.yml");
  return run(
    "docker",
    ["compose", "-f", compose, "exec", "-T", "postgres", "psql", "-U", "postgres", "-tAc", sql],
    {
      capture: true,
    },
  );
}

/**
 * 作業場所づくりのロックを取る。2つのセッションが同時に pnpm worktree:new を動かしても、同じポートのずらし幅を選ばないよう、
 * ずらし幅を選んで .env.worktree を書くまでを1つずつにする。ロックは git の共通のフォルダ（.git）に置くファイル。
 * @param {string} main - もとの作業場所
 * @returns {() => void} ロックを外す関数
 */
function lockAllocation(main) {
  const common = run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: main,
    capture: true,
  });
  const file = join(common, "meguru-worktree.lock");
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const fd = openSync(file, "wx");
      writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
      closeSync(fd);
      return () => rmSync(file, { force: true });
    } catch (err) {
      if (!(err instanceof Error) || /** @type {NodeJS.ErrnoException} */ (err).code !== "EEXIST")
        throw err;
      // 10分より古いロックは、止まったスクリプトの残りとみなして消す
      try {
        if (Date.now() - statSync(file).mtimeMs > 10 * 60_000) rmSync(file, { force: true });
      } catch {
        // 消えていれば、そのまま取り直す
      }
      if (Date.now() > deadline)
        throw new Error(
          `ほかの pnpm worktree:new が終わりません（${file}）。動いていなければ、このファイルを消してください`,
          { cause: err },
        );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
}

/**
 * 作業場所を作る。
 * @param {string} name - 名前
 * @param {string | undefined} branchArg - ブランチ（省略すると feature/<名前>）
 */
function create(name, branchArg) {
  const list = worktrees();
  const main = list[0].path;
  const path = join(dirname(main), `${basename(main)}-${name}`);
  if (existsSync(path)) throw new Error(`${path} はもうあります`);
  const branch = branchArg ?? `feature/${name}`;

  // ずらし幅を選んで .env.worktree を書くまでは、ほかの pnpm worktree:new と重ならないようにする
  const unlock = lockAllocation(main);
  /** @type {number} */
  let portOffset;
  const dbName = `threads_grower_${name.replace(/-/g, "_")}`;
  try {
    // ロックを取ってから一覧を読み直す（待っている間に、ほかの作業場所ができていることがある）
    portOffset = allocate(worktrees());
    createWorktree(main, path, branch);
    writeFileSync(
      join(path, ".env.worktree"),
      [
        "# この作業場所（git worktree）だけの値。pnpm worktree:new が作った（コミットしない）",
        `MEGURU_DB_NAME=${dbName}`,
        `MEGURU_PORT_OFFSET=${portOffset}`,
        "",
      ].join("\n"),
    );
  } finally {
    unlock();
  }
  setUp(main, path, branch, dbName, portOffset);
}

/**
 * 空いているポートのずらし幅を選ぶ。
 * @param {{ path: string }[]} list - 作業場所の一覧
 * @returns {number} ずらし幅
 */
function allocate(list) {
  const used = new Set(list.map((w) => readWorktreeEnv(w.path).portOffset));
  let portOffset = 0;
  for (let k = 1; k <= MAX_WORKTREES; k++) {
    if (!used.has(k * PORT_STEP)) {
      portOffset = k * PORT_STEP;
      break;
    }
  }
  if (!portOffset)
    throw new Error(
      `作業場所は${MAX_WORKTREES}個までです。使わないものを pnpm worktree:remove で片付けてください`,
    );
  return portOffset;
}

/**
 * git の作業場所を作る（ブランチがなければ、develop の最新から作る）。
 * @param {string} main - もとの作業場所
 * @param {string} path - 作る場所
 * @param {string} branch - ブランチ
 */
function createWorktree(main, path, branch) {
  const exists = run("git", ["branch", "--list", branch], { cwd: main, capture: true }) !== "";
  if (exists) {
    run("git", ["worktree", "add", path, branch], { cwd: main });
  } else {
    run("git", ["fetch", "origin", "develop"], { cwd: main });
    run("git", ["worktree", "add", "-b", branch, path, "origin/develop"], { cwd: main });
  }
}

/**
 * 作った作業場所の中身を用意する（設定ファイル・DB・依存・マイグレーション）。
 * @param {string} main - もとの作業場所
 * @param {string} path - 作業場所
 * @param {string} branch - ブランチ
 * @param {string} dbName - DBの名前
 * @param {number} portOffset - ポートのずらし幅
 */
function setUp(main, path, branch, dbName, portOffset) {
  // 手元の設定ファイル（コミットしないもの）を、もとの作業場所から写し、DBとポートを書き換える
  const api = 8787 + portOffset;
  const web = 5173 + portOffset;
  const copies = [
    {
      file: "apps/api/.dev.vars",
      edit: (t) =>
        setVar(
          setVar(t, "DATABASE_URL", `postgres://postgres:postgres@db.localtest.me:5432/${dbName}`),
          "WEB_ORIGIN",
          `http://localhost:${web}`,
        ),
    },
    {
      file: "apps/web/.env.local",
      edit: (t) => setVar(t, "VITE_API_BASE_URL", `http://localhost:${api}`),
    },
    { file: "e2e/.env.local", edit: (t) => t },
  ];
  for (const { file, edit } of copies) {
    const from = join(main, file);
    if (!existsSync(from)) {
      console.warn(`⚠ ${file} が、もとの作業場所にありません。あとで自分で作ってください`);
      continue;
    }
    copyFileSync(from, join(path, file));
    writeFileSync(join(path, file), edit(readFileSync(join(path, file), "utf8")));
  }

  // 4. この作業場所のDB（同じ Postgres の中に、別の名前で作る）
  run("docker", ["compose", "-f", join(main, "docker-compose.yml"), "up", "-d", "--wait"]);
  if (psql(main, `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`) !== "1") {
    psql(main, `CREATE DATABASE "${dbName}"`);
  }

  // 5. 依存とマイグレーション（drizzle.config.ts が .env.worktree を読み、この作業場所のDBに当てる）
  run("pnpm", ["install", "--frozen-lockfile"], { cwd: path });
  run("pnpm", ["--filter", "api", "db:migrate"], { cwd: path });

  console.log(`
作業場所を作りました。
  場所      ${path}
  ブランチ  ${branch}
  DB        ${dbName}
  ポート    Web ${web}・API ${api}（決まったポートに ${portOffset} を足した値）

この作業場所で Claude Code を開く：
  cd ${path} && claude
`);
}

/** 作業場所の一覧を出す。 */
function list() {
  for (const [i, w] of worktrees().entries()) {
    const { dbName, portOffset } = readWorktreeEnv(w.path);
    console.log(
      `${i === 0 ? "（もと）" : "        "} ${w.path}\n          ブランチ ${w.branch}・DB ${dbName}・Web ${5173 + portOffset}・API ${8787 + portOffset}`,
    );
  }
}

/**
 * 作業場所を片付ける。作業場所に変更が残っていたら止める（git worktree remove のまま）。ブランチは残す。
 * @param {string} name - 名前
 */
function remove(name) {
  const all = worktrees();
  const main = all[0].path;
  const path = join(dirname(main), `${basename(main)}-${name}`);
  const target = all.find((w) => w.path === path);
  if (!target)
    throw new Error(`${path} という作業場所はありません（pnpm worktree:list で確かめてください）`);
  const { dbName } = readWorktreeEnv(path);
  if (dbName === "threads_grower") throw new Error("もとの作業場所のDBは消せません");
  run("git", ["worktree", "remove", path], { cwd: main });
  psql(main, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  console.log(
    `作業場所 ${path} と、DB ${dbName} を消しました。ブランチ ${target.branch} は残しています。`,
  );
}

/**
 * 今いる作業場所のDBを消して作り直し、マイグレーションを当て直す。中のデータはすべて消える。
 * @param {boolean} yes - --yes が付いているか（付いていなければ、消すDBを出して止める）
 */
function resetDb(yes) {
  const all = worktrees();
  const main = all[0].path;
  const here = run("git", ["rev-parse", "--show-toplevel"], { capture: true });
  const { dbName } = readWorktreeEnv(here);
  if (!yes) {
    console.error(
      `DB ${dbName}（${here}）を消して作り直します。中のデータはすべて消えます。よければ --yes を付けて実行してください`,
    );
    process.exit(1);
  }
  run("docker", ["compose", "-f", join(main, "docker-compose.yml"), "up", "-d", "--wait"]);
  psql(main, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  psql(main, `CREATE DATABASE "${dbName}"`);
  // もとのDB（threads_grower）には local-neon-http-proxy が起動のときに作る表（neon_control_plane）があるので、
  // 作り直したら代理を起動し直して作り直させる（しないと結合テストが「Control plane request failed」で落ちる）
  if (dbName === "threads_grower") {
    run("docker", ["compose", "-f", join(main, "docker-compose.yml"), "restart", "neon-proxy"]);
  }
  run("pnpm", ["--filter", "api", "db:migrate"], { cwd: here });
  console.log(`DB ${dbName} を作り直し、マイグレーションを当てました。`);
}

const [command, name, branch] = process.argv.slice(2);
try {
  if (command === "list") list();
  else if (command === "reset-db") resetDb(name === "--yes");
  else if (
    (command === "new" || command === "remove") &&
    name &&
    /^[a-z][a-z0-9-]{0,30}$/.test(name)
  ) {
    if (command === "new") create(name, branch);
    else remove(name);
  } else {
    console.error(
      "使い方:\n  pnpm worktree:new <名前> [ブランチ]\n  pnpm worktree:list\n  pnpm worktree:remove <名前>\n  pnpm worktree:reset-db --yes\n（名前は英小文字・数字・ハイフン。例：memo）",
    );
    process.exit(1);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
