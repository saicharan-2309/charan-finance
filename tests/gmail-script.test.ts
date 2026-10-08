/**
 * The Gmail setup script, run against fake Google services: it installs its
 * 5-minute trigger, sends each bank email exactly once, and checks in when
 * there's nothing new.
 */
import { gmailScript } from '@/lib/gmail-script';

function harness(emails: { id: string; from: string; subject: string; body: string; ageHours: number }[]) {
  const posts: Record<string, unknown>[] = [];
  const triggers: string[] = [];
  const props: Record<string, string> = {};
  let searched = '';
  const msg = (e: (typeof emails)[number]) => ({
    getId: () => e.id,
    getFrom: () => e.from,
    getSubject: () => e.subject,
    getPlainBody: () => e.body,
    getDate: () => new Date(Date.now() - e.ageHours * 3600_000),
  });
  const google = {
    GmailApp: {
      search: (q: string) => {
        searched = q;
        return [{ getMessages: () => emails.map(msg) }];
      },
    },
    UrlFetchApp: {
      fetch: (_url: string, opts: { payload: string }) => {
        posts.push(JSON.parse(opts.payload));
        return { getResponseCode: () => 200, getContentText: () => '{}' };
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props[k] ?? null,
        setProperty: (k: string, v: string) => {
          props[k] = v;
        },
      }),
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      deleteTrigger: () => {},
      newTrigger: (fn: string) => ({
        timeBased: () => ({
          everyMinutes: (n: number) => ({
            create: () => {
              triggers.push(`${fn} every ${n} min`);
            },
          }),
        }),
      }),
    },
    Logger: { log: () => {} },
  };
  const script = gmailScript('https://example.supabase.co/functions/v1/ingest-sms', 'cfsync_test');
  const run = new Function(
    ...Object.keys(google),
    `${script}\nreturn { setup: setup, sendToBud: sendToBud };`,
  )(...Object.values(google)) as { setup: () => void; sendToBud: () => void };
  return { run, posts, triggers, searched: () => searched };
}

it('installs a 5-minute trigger and sends recent bank emails once', () => {
  const h = harness([
    {
      id: 'a',
      from: 'Axis Bank <alerts@axisbank.com>',
      subject: 'Transaction alert',
      body: 'Spent INR 2285',
      ageHours: 1,
    },
    { id: 'old', from: 'alerts@axisbank.com', subject: 'Old', body: 'Spent INR 10', ageHours: 72 },
  ]);
  h.run.setup();
  expect(h.triggers).toEqual(['sendToBud every 5 min']);
  expect(h.searched()).toMatch(/^from:\(axisbank\.com OR hdfcbank\.net .* bank\.in\) newer_than:2d$/);
  expect(h.posts).toEqual([
    {
      key: 'cfsync_test',
      channel: 'email',
      messages: [
        {
          sender: 'Axis Bank <alerts@axisbank.com>',
          subject: 'Transaction alert',
          text: 'Spent INR 2285',
          received_at: expect.any(String),
        },
      ],
    },
  ]);

  // Next run: nothing new → only the "still connected" heartbeat.
  h.run.sendToBud();
  expect(h.posts[1]).toEqual({ key: 'cfsync_test', channel: 'email', test: true });
});
