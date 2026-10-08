/**
 * The Google Apps Script that forwards bank alert emails from the user's own
 * Gmail to BUD. It runs in their Google account (script.google.com), every 5
 * minutes, on Google's servers — BUD never gets access to the mailbox.
 *
 * It searches only for mail from banks' own domains in the last 2 days,
 * sends each email once (remembering which it sent), and checks in on every
 * run so the app can show "Gmail connected · checked 2 min ago".
 */
import { GMAIL_BANK_QUERY } from './bank-email';

export function gmailScript(url: string, key: string): string {
  return `/**
 * BUD — sends your bank alert emails to your BUD app.
 *
 * One-time setup: make sure "setup" is selected at the top, press Run, and
 * allow access. After that it checks Gmail every 5 minutes by itself.
 * It only reads emails from banks, and sends them only to your own BUD.
 * To stop it, delete this project.
 */
const BUD_URL = '${url}';
const BUD_KEY = '${key}';
const SEARCH = '${GMAIL_BANK_QUERY} newer_than:2d';

function setup() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sendToBud'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendToBud').timeBased().everyMinutes(5).create();
  sendToBud();
  Logger.log('BUD is connected. You can close this tab.');
}

function sendToBud() {
  var store = PropertiesService.getScriptProperties();
  var sent = JSON.parse(store.getProperty('sent') || '{}');
  var since = Date.now() - 2 * 24 * 3600 * 1000;
  var messages = [];
  GmailApp.search(SEARCH, 0, 50).forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      var id = m.getId();
      if (sent[id] || m.getDate().getTime() < since) return;
      messages.push({
        id: id,
        sender: m.getFrom(),
        subject: m.getSubject(),
        text: m.getPlainBody().slice(0, 8000),
        received_at: m.getDate().toISOString(),
      });
    });
  });

  function post(body) {
    body.key = BUD_KEY;
    body.channel = 'email';
    return UrlFetchApp.fetch(BUD_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
  }

  if (messages.length === 0) {
    post({ test: true });
    return;
  }
  for (var i = 0; i < messages.length; i += 50) {
    var batch = messages.slice(i, i + 50);
    var res = post({
      messages: batch.map(function (m) {
        return { sender: m.sender, subject: m.subject, text: m.text, received_at: m.received_at };
      }),
    });
    if (res.getResponseCode() !== 200) throw new Error('BUD: ' + res.getContentText());
    batch.forEach(function (m) { sent[m.id] = Date.now(); });
  }
  Object.keys(sent).forEach(function (id) { if (sent[id] < since - 86400000) delete sent[id]; });
  store.setProperty('sent', JSON.stringify(sent));
}
`;
}
