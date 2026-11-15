// 人物メモの画面（/people/*）の共通の親（specs/people/001-people-memo contracts/ui-routes.md 1）。
// 利用の許可がない人（/api/me の available に people がない）には「使えない」画面を出す。
// 開いている間に人物メモのAPIが 403 APP_NOT_AVAILABLE を返したとき（運営者が閉じた）も、同じ画面に替える。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { HomeLinkProvider } from "@/lib/home-link";
import { api, ApiError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { peopleHomePath } from "../lib/paths";
import { PeopleShell } from "./PeopleShell";
import { PeopleUnavailable } from "./PeopleUnavailable";

/** 人物メモのアプリのID（@meguru/shared の APP_CATALOG）。 */
const PEOPLE_APP_ID = "people";

/**
 * 失敗が「このアプリは使えない」かを調べる。
 * @param error - 失敗
 * @returns 403 APP_NOT_AVAILABLE なら true
 */
export function isAppNotAvailable(error: unknown): boolean {
  return error instanceof ApiError && error.code === "APP_NOT_AVAILABLE";
}

/**
 * 人物メモの読み込み・書き込みが、新しく 403 APP_NOT_AVAILABLE になったかを見張る。
 * 前から残っている失敗（開く前の退会の確かめなど）や、ほかのアプリの失敗では切り替えない（PR #111 のセルフレビュー）。
 * @returns なったら true
 */
function useAppNotAvailableSeen(): boolean {
  const queryClient = useQueryClient();
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const offQueries = queryClient.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "error" && e.query.queryKey[0] === "people" && isAppNotAvailable(e.action.error)) setSeen(true);
    });
    const offMutations = queryClient.getMutationCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "error" && isAppNotAvailable(e.action.error)) setSeen(true);
    });
    return () => {
      offQueries();
      offMutations();
    };
  }, [queryClient]);
  return seen;
}

/**
 * 人物メモの画面の共通の親。
 * @returns 画面の枠と中の画面、または使えない画面
 */
export function PeopleLayout() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const blocked = useAppNotAvailableSeen();
  if (blocked) return <PeopleUnavailable />;
  if (me.isPending) return <LoadingSkeleton />;
  if (me.isLoadingError) return <ApiErrorScreen error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data.apps.available.includes(PEOPLE_APP_ID)) return <PeopleUnavailable />;
  return (
    <HomeLinkProvider value={peopleHomePath()}>
      <PeopleShell>
        <Outlet />
      </PeopleShell>
    </HomeLinkProvider>
  );
}
