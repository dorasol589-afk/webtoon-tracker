"use server";

import { revalidatePath } from "next/cache";
import { setJobApplied } from "@/lib/queries";

export async function setJobAppliedAction(source: string, postingId: string, applied: boolean) {
  await setJobApplied(source, postingId, applied);
  revalidatePath("/recruit");
  revalidatePath("/studios", "layout");
}
