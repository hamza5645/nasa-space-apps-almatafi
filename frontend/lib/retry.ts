// When TanStack Query should try a failed request again.
// A 4xx answer (a bad area, too large, out of range, unknown region) won't change on a
// second try, and retrying it doubles slow backend work, e.g. a big area's calendar
// refused with 422. Network failures and 5xx get one more try.
//
// One 4xx can change: an admin area the server hasn't fetched yet. A share link restores
// the area and asks /api/admin for its outline at the same moment, and on a server without
// that country cached the calendar can arrive first and get 404. TanStack waits 1, 2, then
// 4 s between tries, enough for the country's download (about a second).

import { ApiError } from "./api.ts";

export function shouldRetry(failures: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status === 404 && "admin_id" in error.details) return failures < 3;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failures < 1;
}
