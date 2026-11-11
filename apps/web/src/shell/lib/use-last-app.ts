// 最後に使ったアプリを覚える（specs/028-meguru-shell contracts/ui-routes.md 6）。
// アプリのパスの下の画面を開いたとき、/api/me の apps.last がそのアプリでなければ、PUT /api/me/last-app を1回呼ぶ。
// 失敗しても画面には何も出さない（次の入口で、使っているアプリの最初になるだけ）。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useCurrentApp } from "../app-module";

/**
 * 今開いているアプリを、最後に使ったアプリとして覚える。/apps・/settings など、どのアプリのパスでもない画面では何もしない。
 */
export function useRememberLastApp(): void {
  const app = useCurrentApp();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, enabled: Boolean(app) });
  // 同じアプリで二重に送らない（読み直しの途中など）
  const sent = useRef<string | null>(null);
  const last = me.data?.apps?.last ?? null;
  useEffect(() => {
    if (!app || !me.data || last === app.id || sent.current === app.id) return;
    sent.current = app.id;
    api
      .putLastApp(app.id)
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.me }))
      .catch(() => {
        // 覚えられなくても画面は止めない。次にこのアプリを開いたときにもう一度送る
        sent.current = null;
      });
  }, [app, me.data, last, queryClient]);
}
