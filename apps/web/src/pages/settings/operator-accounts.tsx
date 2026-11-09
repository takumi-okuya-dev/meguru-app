// 設定 > 運営 > アカウント一覧（specs/026-operator-accounts contracts/ui-routes.md、US1〜US3、FR-001〜FR-014）。
// 運営者だけ。すべてのアカウントを、接続方法・接続の状態・オーナー・テスター招待の状態とともに見る。見るだけ。
// 画面はモック（https://claude.ai/artifact/BgQqyj6fDtY6KeNYYFQm4W ）。タブと行の枠は「テスター招待」にそろえた。
import {
  CONNECTION_STATUS_LABELS,
  OPERATOR_ACCOUNTS_QUERY_MAX,
  OPERATOR_ACCOUNT_METHODS,
  OPERATOR_ACCOUNT_METHOD_LABELS,
  OPERATOR_ACCOUNT_TESTER_LABELS,
  type OperatorAccount,
  type OperatorAccountMethodFilter,
} from "@threads-grower/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api, describeError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { MD_QUERY, useMediaQuery } from "@/lib/use-media-query";

/** 入力が止まってから読み込むまでの時間（research.md R3）。 */
const SEARCH_DELAY_MS = 300;

/** 表の列（md以上。contracts/ui-routes.md 2-4）。 */
const GRID = "md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.5fr)_minmax(0,0.8fr)] md:gap-4";

/**
 * オーナーの名前と、持っているアカウントの数（「山田 太郎（2件）」）。
 * @param owner - オーナー
 * @returns 表示の文字列
 */
const ownerLabel = (owner: NonNullable<OperatorAccount["owner"]>) => `${owner.name ?? "名前なし"}（${owner.accountCount}件）`;

/**
 * アカウント一覧（/settings/operator-accounts）。
 * @returns 画面
 */
export function OperatorAccountsPage() {
  const isWide = useMediaQuery(MD_QUERY);
  const searchId = useId();
  const [method, setMethod] = useState<OperatorAccountMethodFilter>("all");
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");

  // 入力が止まってから読み込む
  useEffect(() => {
    const timer = setTimeout(() => setQ(input.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const list = useInfiniteQuery({
    queryKey: queryKeys.operatorAccounts(method, q),
    queryFn: ({ pageParam }) => api.operatorAccounts({ method, q, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const counts = list.data?.pages[0]?.counts;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  // 運営者でない人が直接開いたとき（今の運営の区分と同じ。contracts/ui-routes.md 1）
  if (list.isError && list.error instanceof ApiError && list.error.code === "OPERATOR_ONLY") {
    return <p className="text-sm text-muted-foreground">この画面は運営者だけが使えます。</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold max-md:hidden">アカウント一覧</h1>
        <p className="text-sm text-muted-foreground">すべてのアカウントと、Threadsへのつなぎ方です。見るだけで、ここからは変えられません。</p>
      </div>

      <div className="flex max-w-md flex-col gap-1.5">
        <label htmlFor={searchId} className="text-[13px] text-muted-foreground">
          アカウント・@ユーザー名・オーナーで探す
        </label>
        <Input
          id={searchId}
          type="search"
          value={input}
          maxLength={OPERATOR_ACCOUNTS_QUERY_MAX}
          placeholder="例：taku、shop、メールアドレス"
          onChange={(e) => setInput(e.target.value)}
        />
      </div>

      <Tabs value={method} onValueChange={(v) => setMethod(v as OperatorAccountMethodFilter)}>
        <TabsList className="flex-wrap">
          {OPERATOR_ACCOUNT_METHODS.map((m) => (
            <TabsTrigger key={m} value={m}>
              {OPERATOR_ACCOUNT_METHOD_LABELS[m]} {counts?.[m] ?? ""}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {list.isPending ? (
        <p className="text-sm text-muted-foreground">読み込み中…</p>
      ) : list.isError && items.length === 0 ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {describeError(list.error)}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">ありません</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          {isWide && (
            <div className={`${GRID} border-b bg-muted/40 px-5 py-2.5 text-xs text-muted-foreground`} aria-hidden="true">
              <span>アカウント</span>
              <span>接続方法</span>
              <span>状態</span>
              <span>オーナー</span>
              <span>テスター招待</span>
            </div>
          )}
          <ul className="divide-y px-4 md:px-0">
            {items.map((item) => (isWide ? <WideRow key={item.id} item={item} /> : <NarrowRow key={item.id} item={item} />))}
          </ul>
        </div>
      )}

      {list.hasNextPage && (
        <div className="space-y-2">
          <Button
            variant="outline"
            className="h-10 rounded-full md:h-9"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            もっと見る
          </Button>
          {list.isFetchNextPageError && (
            <p role="alert" className="text-sm text-muted-foreground">
              {describeError(list.error)}
            </p>
          )}
        </div>
      )}

      <p className="text-[13px] text-muted-foreground">作った日の新しい順。テスター招待の操作は「テスター招待」で行います。</p>
    </div>
  );
}

/**
 * 広い画面の1行（5列の表）。
 * @param props - item：行
 * @returns 行
 */
function WideRow({ item }: { item: OperatorAccount }) {
  return (
    <li className={`${GRID} items-center px-5 py-3.5 text-sm`}>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{item.name}</span>
        <span className="truncate text-[13px] text-muted-foreground">{item.username ? `@${item.username}` : "未接続"}</span>
      </div>
      <span>{OPERATOR_ACCOUNT_METHOD_LABELS[item.method]}</span>
      <span>{CONNECTION_STATUS_LABELS[item.status]}</span>
      {item.owner ? (
        <div className="flex min-w-0 flex-col">
          <span className="truncate">{ownerLabel(item.owner)}</span>
          <span className="truncate text-[13px] text-muted-foreground">{item.owner.email}</span>
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      {item.tester ? <span>{OPERATOR_ACCOUNT_TESTER_LABELS[item.tester]}</span> : <span className="text-muted-foreground">—</span>}
    </li>
  );
}

/**
 * 狭い画面の1行（段に分ける。contracts/ui-routes.md 2-4）。
 * @param props - item：行
 * @returns 行
 */
function NarrowRow({ item }: { item: OperatorAccount }) {
  const method = OPERATOR_ACCOUNT_METHOD_LABELS[item.method];
  return (
    <li className="flex flex-col gap-1 py-3.5 text-sm">
      <div className="flex justify-between gap-3">
        <span className="min-w-0 font-semibold break-words">{item.name}</span>
        <span className="shrink-0">{CONNECTION_STATUS_LABELS[item.status]}</span>
      </div>
      <span className="text-[13px] break-all text-muted-foreground">{item.username ? `@${item.username}・${method}` : `未接続・${method}`}</span>
      <span className="text-[13px] break-all text-muted-foreground">
        {item.owner ? `オーナー：${ownerLabel(item.owner)}・${item.owner.email}` : "オーナー：—"}
      </span>
      {item.tester && <span className="text-[13px]">テスター招待：{OPERATOR_ACCOUNT_TESTER_LABELS[item.tester]}</span>}
    </li>
  );
}
