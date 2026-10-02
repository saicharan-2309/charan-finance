// Supabase Edge Function: delete-account
// -----------------------------------------------------------------------------
// Permanently deletes the calling user's account and all their data.
// Required by App Store Review Guideline 5.1.1(v) for apps that offer sign-up.
//
//   * The caller is identified from their own JWT — a user can only delete
//     themselves.
//   * The service role key is read from the function's environment (injected by
//     Supabase). It is never shipped in the mobile app.
//   * Receipt files are removed first; deleting the auth user then cascades to
//     every table (all user_id FKs are ON DELETE CASCADE).
// -----------------------------------------------------------------------------
import { createClient } from 'jsr:@supabase/supabase-js@2';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'unauthorized' });

  let body: { confirm?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  if (body.confirm !== 'DELETE') return json(400, { error: 'confirmation_required' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return json(401, { error: 'unauthorized' });
  const uid = data.user.id;

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Remove every receipt under <uid>/ (walks folders, 1000 entries per page).
  async function removeFolder(prefix: string): Promise<void> {
    for (;;) {
      const { data: entries, error: listError } = await admin.storage
        .from('receipts')
        .list(prefix, { limit: 1000 });
      if (listError) throw listError;
      if (!entries || entries.length === 0) return;
      const files = entries.filter((e) => e.id !== null).map((e) => `${prefix}/${e.name}`);
      const folders = entries.filter((e) => e.id === null).map((e) => `${prefix}/${e.name}`);
      for (const f of folders) await removeFolder(f);
      if (files.length > 0) {
        const { error: rmError } = await admin.storage.from('receipts').remove(files);
        if (rmError) throw rmError;
      }
      if (entries.length < 1000) return;
    }
  }

  try {
    await removeFolder(uid);
  } catch (e) {
    console.error('receipt_cleanup_failed', (e as Error).name);
    return json(500, { error: 'cleanup_failed' });
  }

  const { error: delError } = await admin.auth.admin.deleteUser(uid);
  if (delError) {
    console.error('delete_user_failed', delError.status);
    return json(500, { error: 'delete_failed' });
  }
  return json(200, { deleted: true });
});
