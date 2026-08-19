/** One place to turn a thrown error into copy fit for a toast. */
export function describeApiError(
  error: unknown,
  _t?: (key: string, def?: string) => string,
): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}
