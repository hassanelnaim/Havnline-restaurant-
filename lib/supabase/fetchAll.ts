/**
 * Supabase returns at most 1,000 rows per request, and says nothing when
 * it cuts a result short. Lists that can grow past that (a big menu's
 * options, a busy week's orders, every customer) used to lose rows
 * silently: the AI couldn't see some menu options, and reports undercounted.
 *
 * fetchAllRows pages through with .range() until a short page comes back.
 * The query must have a stable order (end it with .order("id") if nothing
 * else makes rows unique), or rows can repeat or go missing between pages.
 */
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => Page<T>,
  options: { maxRows?: number } = {}
): Promise<{ data: T[]; error: { message: string } | null }> {
  const maxRows = options.maxRows ?? 50_000;
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await page(from, Math.min(from + PAGE_SIZE, maxRows) - 1);
    if (error) return { data: rows, error };
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

/**
 * Rows whose `column` is in `ids`, for any number of ids. A long .in() list
 * makes a URL too long for the database API to accept, so ids go in
 * chunks, and each chunk is paged with fetchAllRows.
 */
export async function fetchRowsByIds<T>(
  ids: readonly string[],
  page: (chunk: string[], from: number, to: number) => Page<T>,
  chunkSize = 150
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await fetchAllRows<T>((from, to) => page(chunk, from, to));
    if (error) return { data: rows, error };
    rows.push(...data);
  }
  return { data: rows, error: null };
}
