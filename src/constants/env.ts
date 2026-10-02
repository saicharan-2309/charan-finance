/**
 * Public runtime configuration. EXPO_PUBLIC_* variables are inlined at build
 * time (from .env locally, or EAS environment variables for cloud builds).
 * Only PUBLIC values belong here — never the service role key.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isConfigured = /^https:\/\/.+/.test(supabaseUrl) && supabaseAnonKey.length > 20;

export const env = {
  // A syntactically valid placeholder keeps createClient from throwing so the
  // app can show a clear "not configured" screen instead of crashing.
  supabaseUrl: isConfigured ? supabaseUrl : 'https://not-configured.supabase.co',
  supabaseAnonKey: isConfigured ? supabaseAnonKey : 'not-configured',
  appScheme: 'charanfinance',
} as const;
