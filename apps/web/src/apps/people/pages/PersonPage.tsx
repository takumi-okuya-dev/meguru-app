// 「/people/list/:personId」：人のページ（specs/people/001-people-memo contracts/ui-routes.md 1、US4・US2・US7）。
// 本名（直す）・LINE名と別名・同意（直す・記録）・メモ2つ・来たイベント（新しい順・アンケートの答え・「別の人に分ける」）・
// 声かけの記録（PR3）・「この人と同じ人」（まとめる）・「この人を消す」。
import { useQuery } from "@tanstack/react-query";
import { MergeIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { NotFound, PageBody, PageHeader } from "@/shell";
import { PersonAttendanceSection } from "../components/person/PersonAttendanceSection";
import { PersonConsentSection } from "../components/person/PersonConsentSection";
import { PersonDeleteDialog } from "../components/person/PersonDeleteDialog";
import { PersonMemoSection } from "../components/person/PersonMemoSection";
import { PersonMergeDialog } from "../components/person/PersonMergeDialog";
import { PersonNameSection } from "../components/person/PersonNameSection";
import { PersonOutreachSection } from "../components/person/PersonOutreachSection";
import { peopleApi } from "../lib/api";
import { peopleQueryKeys } from "../lib/query-keys";

/**
 * 人のページ。
 * @returns 画面
 */
export function PersonPage() {
  const { personId = "" } = useParams<{ personId: string }>();
  const detail = useQuery({ queryKey: peopleQueryKeys.person(personId), queryFn: () => peopleApi.person(personId) });
  const [dialog, setDialog] = useState<{ kind: "merge" | "delete"; personId: string } | null>(null);

  if (detail.isPending) return <LoadingSkeleton />;
  if (detail.isError) {
    if (detail.error instanceof ApiError && detail.error.code === "ITEM_NOT_FOUND") return <NotFound message="この人はいません（消したか、まとめた人です）" />;
    return <ApiErrorScreen error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  const { person, attendances, consentChanges, outreaches } = detail.data;
  // 分けたあとに別の人のページへ移ったら、開いていたダイアログは出さない
  const open = dialog?.personId === person.id ? dialog.kind : null;

  return (
    <>
      <PageHeader title={person.displayName} />
      <PageBody className="space-y-6">
        <PersonNameSection key={`name:${person.id}`} person={person} />
        <PersonConsentSection key={`consent:${person.id}`} personId={person.id} consent={person.consent} changes={consentChanges} />
        <PersonMemoSection key={`memo:${person.id}:${person.memoAppearance ?? ""}:${person.memoTalk ?? ""}`} person={person} />
        <PersonAttendanceSection key={`attendance:${person.id}`} personId={person.id} attendances={attendances} />
        <PersonOutreachSection outreaches={outreaches} />

        <section className="flex flex-col gap-2 border-t pt-6 sm:flex-row sm:flex-wrap">
          <Button variant="outline" className="h-11 rounded-full md:h-9" onClick={() => setDialog({ kind: "merge", personId: person.id })}>
            <MergeIcon /> この人と同じ人
          </Button>
          <Button variant="outline" className="h-11 rounded-full text-destructive md:h-9" onClick={() => setDialog({ kind: "delete", personId: person.id })}>
            <Trash2Icon /> この人を消す
          </Button>
        </section>
      </PageBody>

      {open === "merge" && <PersonMergeDialog person={person} onClose={() => setDialog(null)} />}
      {open === "delete" && <PersonDeleteDialog person={person} onClose={() => setDialog(null)} />}
    </>
  );
}
