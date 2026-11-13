// 人を直す・足す・まとめる・分ける・消すのあとに、どのデータを読み直すか（specs/people/001-people-memo contracts/api.md 4）。
import type { QueryClient } from "@tanstack/react-query";
import { peopleQueryKeys } from "./query-keys";

/**
 * 1人の名前・メモ・同意を直したあと：人の一覧と人のページを読み直す。名前が変わったときは、イベントの来た人の一覧も読み直す。
 * @param queryClient - クエリのクライアント
 * @param options - names：名前が変わったか
 * @returns 読み直しが終わるまでの Promise
 */
export async function refreshPersons(queryClient: QueryClient, options: { names?: boolean } = {}): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: peopleQueryKeys.persons }),
    options.names ? queryClient.invalidateQueries({ queryKey: peopleQueryKeys.events }) : undefined,
  ]);
}

/**
 * 人が増える・減る・来た記録が変わったあと（足す・まとめる・分ける・消す・会ったイベントを足す／外す）：
 * もういない人のページは捨て、人物メモのデータをすべて読み直す（参加者数・選べる値・人の数も変わるため）。
 * @param queryClient - クエリのクライアント
 * @param removedPersonIds - もういない人のID
 * @returns 読み直しが終わるまでの Promise
 */
export async function refreshAllPeople(queryClient: QueryClient, removedPersonIds: string[] = []): Promise<void> {
  for (const id of removedPersonIds) queryClient.removeQueries({ queryKey: peopleQueryKeys.person(id) });
  await queryClient.invalidateQueries({ queryKey: peopleQueryKeys.all });
}
