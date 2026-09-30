// A raw Postgres/Supabase error's .message can include real internal
// detail — table names, column names, constraint names, sometimes a
// fragment of the query itself (e.g. `insert or update on table
// "order_items" violates foreign key constraint "order_items_order_id_fkey"`).
// Every server action used to return that string straight to the
// client, unfiltered, as the error a person sees in a toast. This logs
// the real message server-side (still fully visible in Vercel's logs
// for debugging) and returns a plain, generic one to the browser
// instead — nothing about the schema, and no wording differences a
// caller could use to probe whether a record exists.
const DEFAULT_MESSAGE = "Something went wrong — please try again.";

export function dbErrorResult(
  error: { message: string } | null | undefined,
  context: string,
  fallback: string = DEFAULT_MESSAGE
): { success: false; error: string } {
  if (error) console.error(`[${context}]`, error.message);
  return { success: false, error: fallback };
}
