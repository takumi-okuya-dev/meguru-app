// 最後に使ったアプリを覚える（specs/028-meguru-shell contracts/ui-routes.md 6）。
// アプリのパスの下の画面を開いたとき、/api/me の apps.last がそのアプリでなければ、PUT /api/me/last-app を呼ぶ。
// 成功したら、手元の /api/me の apps.last と入口の行き先だけを書き換える（/api/me をまるごと読み直さない）。
// 失敗しても画面には何も出さない（次の入口で、使っているアプリの最初になるだけ）。
import { resolveLandingApp, type MeResponse } from "@meguru/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query";
import { useCurrentApp } from "../app-module";

/**
 * 今開いているアプリを、最後に使ったアプリとして覚える。/apps・/settings など、どのアプリのパスでもない画面では何もしない。
 * 別のタブで別のアプリを開いて apps.last が変わっても、このタブでアプリを使っていれば、読み直したときにもう一度覚え直す。
 */
export function useRememberLastApp(): void {
  const app = useCurrentApp();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, enabled: Boolean(app) });
  // 送っている最中は重ねて送らない
  const inFlight = useRef(false);
  const loaded = Boolean(me.data);
  const last = me.data?.apps.last ?? null;
  useEffect(() => {
    if (!app || !loaded || last === app.id || inFlight.current) return;
    inFlight.current = true;
    api
      .putLastApp(app.id)
      .then(() =>
        queryClient.setQueryData<MeResponse>(queryKeys.me, (d) =>
          d ? { ...d, apps: { ...d.apps, last: app.id, landing: resolveLandingApp(d.apps.using, app.id) } } : d,
        ),
      )
      .catch(() => {
        // 覚えられなくても画面は止めない
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [app, loaded, last, queryClient]);
}
