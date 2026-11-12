// 最後に使ったアプリを覚える（specs/028-meguru-shell contracts/ui-routes.md 6）。
// アプリのパスの下の画面を開いたとき、/api/me の apps.last がそのアプリでなければ、PUT /api/me/last-app を呼ぶ。
// 成功したら、手元の /api/me の apps.last と入口の行き先だけを書き換える（/api/me をまるごと読み直さない）。
// 失敗しても画面には何も出さない（次の入口で、使っているアプリの最初になるだけ）。
import { resolveLandingApp, type MeResponse } from "@meguru/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
  // 送り終えた組（アプリと、そのときの apps.last）。失敗しても、同じ組では送り直さない（送り続けないため）
  const attempted = useRef<string | null>(null);
  // 送り終えたら数を進めて、もう一度確かめる（送っている間に別のアプリへ移っていたら、失敗しても今のアプリを覚えるため）
  const [settled, setSettled] = useState(0);
  const loaded = Boolean(me.data);
  const last = me.data?.apps.last ?? null;
  useEffect(() => {
    if (!app || !loaded || last === app.id || inFlight.current) return;
    const key = `${app.id}|${last ?? ""}`;
    if (attempted.current === key) return;
    inFlight.current = true;
    attempted.current = key;
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
        setSettled((n) => n + 1);
      });
  }, [app, loaded, last, queryClient, settled]);
}
