"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { addToWatchlist, removeFromWatchlist } from "@/lib/queries";
import { WATCHLIST_USER_COOKIE } from "@/lib/watchlistCookie";

export async function setWatchlistUserAction(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const store = await cookies();
  store.set(WATCHLIST_USER_COOKIE, trimmed, { maxAge: 60 * 60 * 24 * 365, path: "/" });
}

export async function clearWatchlistUserAction() {
  const store = await cookies();
  store.delete(WATCHLIST_USER_COOKIE);
}

export async function addToWatchlistAction(userName: string, titleId: number) {
  await addToWatchlist(userName, titleId);
  revalidatePath("/");
}

export async function removeFromWatchlistAction(userName: string, titleId: number) {
  await removeFromWatchlist(userName, titleId);
  revalidatePath("/");
}
