// Supabase Edge Function: receipt-ocr
// -----------------------------------------------------------------------------
// Extracts raw text from a receipt image the caller has already uploaded to the
// private `receipts` bucket. It NEVER creates financial records: the app parses
// the text into a *suggestion* that the user must review and confirm.
//
// Security
//   * JWT verification is on (default). The storage download uses the caller's
//     own JWT, so RLS guarantees users can only OCR their own files.
//   * The OCR provider key lives in Supabase secrets, never in the app:
//       supabase secrets set GOOGLE_VISION_API_KEY=...
//   * Without a key the function returns 501 and the app falls back to manual
//     entry (the receipt is still attached).
// -----------------------------------------------------------------------------
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'unauthorized' });

  let path: unknown;
  try {
    ({ path } = await req.json());
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  if (typeof path !== 'string' || path.length > 512 || path.includes('..')) {
    return json(400, { error: 'invalid_path' });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json(401, { error: 'unauthorized' });
  if (!path.startsWith(`${userData.user.id}/`)) return json(403, { error: 'forbidden' });

  const apiKey = Deno.env.get('GOOGLE_VISION_API_KEY');
  if (!apiKey) return json(501, { error: 'ocr_not_configured' });

  const { data: file, error: dlError } = await supabase.storage.from('receipts').download(path);
  if (dlError || !file) return json(404, { error: 'file_not_found' });
  if (file.size > MAX_BYTES) return json(413, { error: 'file_too_large' });
  if (!IMAGE_TYPES.has(file.type)) return json(415, { error: 'unsupported_type' });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const visionRes = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { content: toBase64(bytes) },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          },
        ],
      }),
    },
  );

  if (!visionRes.ok) {
    // Do not echo provider responses (may contain request details) to the client.
    console.error('vision_error', visionRes.status);
    return json(502, { error: 'ocr_failed' });
  }

  const result = await visionRes.json();
  const text: string = result?.responses?.[0]?.fullTextAnnotation?.text ?? '';
  return json(200, { text: text.slice(0, 20000) });
});
