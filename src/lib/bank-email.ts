/**
 * The bank-email reader lives with the Edge Function (Deno must import it
 * without the app's build tooling); the app re-exports the same file so the
 * tests cover exactly what the server runs.
 */
export * from '../../supabase/functions/_shared/bank-email';
