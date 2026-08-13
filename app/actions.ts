"use server";

import { revalidatePath } from "next/cache";
import { updateTitleStudioName } from "@/lib/queries";

export async function updateTitleStudioNameAction(titleId: number, studioName: string) {
  await updateTitleStudioName(titleId, studioName);
  revalidatePath("/");
  revalidatePath("/studios", "layout");
}
