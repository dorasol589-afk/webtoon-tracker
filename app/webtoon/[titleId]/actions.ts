"use server";

import { revalidatePath } from "next/cache";
import { saveEpisodeTreatment, saveTitleNotes, type TitleNotes } from "@/lib/queries";

export async function saveTreatmentAction(titleId: number, no: number, treatment: string) {
  await saveEpisodeTreatment(titleId, no, treatment);
  revalidatePath(`/webtoon/${titleId}`);
}

export async function saveTitleNotesAction(titleId: number, notes: TitleNotes) {
  await saveTitleNotes(titleId, notes);
  revalidatePath(`/webtoon/${titleId}`);
}
