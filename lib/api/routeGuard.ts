import { NextResponse } from "next/server";

/**
 * Wraps an API route handler so an error thrown anywhere inside it is
 * logged (with the route's name) and answered with a clean JSON error,
 * instead of an unhandled exception that becomes a bare, empty 500.
 *
 * The printer tablet reads `{ success: false, error }` from every route;
 * this keeps that shape even when something unexpected breaks, so the app
 * can show the message and retry instead of choking on a non-JSON reply.
 */
export function guardRoute<A extends unknown[]>(label: string, handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error(`[${label}] unhandled error:`, err);
      return NextResponse.json({ success: false, error: "Something went wrong on our end. Please try again." }, { status: 500 });
    }
  };
}
