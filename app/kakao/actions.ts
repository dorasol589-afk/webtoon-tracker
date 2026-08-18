"use server";

import { revalidatePath } from "next/cache";
import { updateKakaoTitleStudioName } from "@/lib/queries";

export async function updateKakaoTitleStudioNameAction(contentId: number, studioName: string) {
  await updateKakaoTitleStudioName(contentId, studioName);
  revalidatePath("/kakao");
}
