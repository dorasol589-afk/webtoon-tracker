/** "use server" 파일(app/watchlistActions.ts)은 async 함수만 export할 수 있어서,
 * 여러 곳에서 공유해야 하는 이 상수는 별도 파일로 분리해둔다. */
export const WATCHLIST_USER_COOKIE = "watchlist_user";
