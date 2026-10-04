/**
 * The bank SMS parser lives with the Edge Function (it must be importable by
 * Deno without the app's build tooling); the app re-exports the same file so
 * the in-app preview reads messages exactly as the server will.
 */
export * from '../../supabase/functions/_shared/bank-sms';
