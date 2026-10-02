import { Screen, Section } from '@/components/ui/layout';
import { Card, Text } from '@/components/ui/primitives';
import { spacing } from '@/theme/tokens';

const SECTIONS: [string, string][] = [
  [
    'What is stored',
    'The accounts, transactions, categories, merchants, budgets, goals, recurring items and receipt images you add, plus your email address and display name. Nothing else is collected — no analytics, advertising identifiers or tracking.',
  ],
  [
    'Where it is stored',
    'In your own Supabase project (PostgreSQL database and private file storage). Every row is tied to your user id and protected by Row Level Security, so other users of the same server cannot read or change it.',
  ],
  [
    'On this iPhone',
    'Your sign-in session is kept in the iOS Keychain. A cache of recent data and any changes waiting to sync are kept in the app’s private storage so the app works offline. Signing out clears them.',
  ],
  [
    'Receipts',
    'Receipt images are stored privately under your user folder and are only viewable through short-lived links. If text recognition is enabled, a receipt image is sent to the configured OCR provider to read its text; the result is only a suggestion you review.',
  ],
  [
    'What is never stored',
    'Bank passwords, internet-banking logins, UPI PINs, full card numbers and CVVs. Only an optional last four digits help you tell cards apart.',
  ],
  [
    'Your control',
    'Export everything as CSV or JSON at any time (More → Export data). Delete your account and all data permanently from More → Security.',
  ],
];

export default function Privacy() {
  return (
    <Screen>
      {SECTIONS.map(([title, body]) => (
        <Section key={title} title={title} style={{ marginBottom: spacing.xl }}>
          <Card variant="muted">
            <Text variant="callout" tone="secondary">
              {body}
            </Text>
          </Card>
        </Section>
      ))}
    </Screen>
  );
}
