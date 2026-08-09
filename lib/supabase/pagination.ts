import "server-only";

export const SUPABASE_PAGE_SIZE = 500;
export const SUPABASE_MAX_PAGINATED_ROWS = 100_000;

type SupabasePageResult<Row> = {
  data: Row[] | null;
  error: unknown;
};

/**
 * Reads a complete, deterministically ordered PostgREST result without relying
 * on the project's max-rows setting. A hard ceiling fails closed instead of
 * silently returning a partial operational snapshot.
 */
export async function fetchAllSupabaseRows<Row>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<SupabasePageResult<Row>>,
  options: {
    pageSize?: number;
    maxRows?: number;
  } = {},
): Promise<Row[]> {
  const pageSize = options.pageSize ?? SUPABASE_PAGE_SIZE;
  const maxRows = options.maxRows ?? SUPABASE_MAX_PAGINATED_ROWS;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new Error("SUPABASE_PAGINATION_PAGE_SIZE_INVALID");
  }
  if (!Number.isSafeInteger(maxRows) || maxRows < pageSize) {
    throw new Error("SUPABASE_PAGINATION_MAX_ROWS_INVALID");
  }

  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;

    const page = data ?? [];
    if (rows.length + page.length > maxRows) {
      throw new Error("SUPABASE_PAGINATION_ROW_LIMIT_EXCEEDED");
    }
    rows.push(...page);
    if (page.length < pageSize) return rows;

    if (rows.length === maxRows) {
      const overflow = await fetchPage(from + pageSize, from + pageSize);
      if (overflow.error) throw overflow.error;
      if ((overflow.data ?? []).length > 0) {
        throw new Error("SUPABASE_PAGINATION_ROW_LIMIT_EXCEEDED");
      }
      return rows;
    }
  }
}
