# BUD — project brief for Claude Code

@AGENTS.md

BUD (formerly "Charan Finance") is a personal-finance app for Charan, in India, plus friends he
shares bills with. Built to be better than Emma in design and at least equal in features. Read
this file and `README.md` before changing anything; this file is the short version of every
decision so far. The repo, Expo slug (`charan-finance`), bundle id and URL scheme keep the old
name on purpose — changing them would detach EAS and the update channel.

## How Charan runs it

- Develops on **Windows, no Mac**. Project lives at `C:\dev\charan-finance`. Shell: PowerShell.
- Runs the app on his iPhone in **Expo Go**, fed by **EAS Update** (branch `main`, environment
  `preview`). There is no installed build yet; that needs the $99 Apple Developer membership.
- So: **only modules bundled in Expo Go**. Don't add a library with native code without
  asking — he can't install a development build today.
- **Face ID does not work in Expo Go** (Expo docs). The app falls back to the iPhone passcode and
  says so. Don't try to "fix" it in code.
- App lock (Security) has two independent switches: **Face ID** (expo-local-authentication, iPhone
  passcode fallback) and an **app passcode** (6 digits, only a salted stretched SHA-256 in the
  Keychain, escalating lockout after 5 wrong tries — `lib/passcode.ts`, `services/app-passcode.ts`).
  Either or both lock the app; "Forgot passcode?" signs out on this device.
- Backend is his own Supabase project (Postgres, Auth, Storage, Edge Functions, RLS).
- He pulls from GitHub (`saicharan-2309/charan-finance`) and ships with:
  1. new migrations first (`npx supabase db push`, or paste into the SQL Editor),
  2. `npx supabase functions deploy <name> --use-api` (`ingest-sms` also needs `--no-verify-jwt`),
  3. `npx eas-cli@latest update --branch main --message "…"` → choose **preview**.

## Stack

Expo SDK 57, React Native 0.86, React 19.2 (React Compiler on), TypeScript strict, Expo Router
(`src/app/`), TanStack React Query, Supabase JS (incl. Realtime). Check versioned Expo docs before
touching any Expo API (see AGENTS.md).

```
src/app/            screens. (tabs)/: Home, Activity (transactions), Friends, Reports — Goals and
                    More are tabs too but live off-bar (Home sections, avatar)
                    friends/, chat/, split/new (THE one split flow), shared/[id], groups/,
                    notifications, balance-groups, review, insights …
src/components/ui/  primitives, controls (Button, Chip, SegmentedControl, HeaderButton…), layout,
                    pickers, feedback, glass.tsx (Liquid Glass), gradient.tsx (measured SVG fills)
src/components/charts/  hand-built SVG charts + Gauge
src/features/       dashboard/ (home-top, home-cards), friends/, reports/overview, insights/
src/theme/tokens.ts THE design system — BUD palette, type, spacing, radius, elevation, charts
src/hooks/data.ts   every React Query hook; src/lib/query.ts the query keys
src/services/       Supabase calls + mappers; friends.ts, balance-groups.ts, app-passcode.ts
src/lib/            pure, unit-tested logic: money (paise), dates, cycles, parsers, splits.ts
                    (bill splitting + fewest-payments settlement), balance-groups.ts, insights.ts
supabase/migrations SQL in filename order; additive, and written to be safe to re-run
supabase/functions  Edge Functions (Deno). _shared/bank-sms.ts is the SMS parser
supabase/tests/     SQL tests (database, seed, bank-sync, friends) against a throwaway Postgres
tests/              Jest
```

## Design system — BUD

All values live in `src/theme/tokens.ts`; components read them via `useTheme()` (which also
returns scheme-aware `elevation`). Never hard-code a colour, size or font.

- **The official BUD logo is the source of truth** (`assets/images/bud-logo-original.png`, as
  supplied by Charan; `bud-logo.png` is a resized copy, also the app icon). Never redraw, recolour
  or crop it — `components/BrandMark.tsx` shows the PNG. Colours were sampled from it (Oct 8):
  navy `#071645` (text `#0B1A45`), dark blue `#1A3FAC` (brand), bright blue `#1067FE` (income),
  cyan `#51ACFE` (accent), coral `#E5445D` (expense), peach `#FE9D72`, off-white canvas.
  **No green in the identity** (Charan dislikes it; `tests/tokens-contrast.test.ts` enforces it
  and WCAG contrast). `BUD_SWATCHES` (11 hues × base/deep/light) is the only palette for payment
  methods, categories, avatars and menu icons. Chart palette alternates cool/warm.
- Canvas: cool off-white with borderless white cards on soft navy-tinted shadows; dark mode is a
  deep navy with cards lifted by tone. Hero, Add button and avatars use the logo tile's gradient
  (blue → dark blue → navy). The coral → peach `gaugeGradient` is progress against a limit.
- Payment-method cards use **the colour the user chose** (`cardGradientFor(account.color)`) —
  never a colour picked by position. The colour picker is `features/shared/ColorPicker.tsx`.
- Type: system face only (SF on iPhone); tabular figures for amounts.
- Shape: continuous corners via `continuous`; radius hierarchy (hero 30, cards 22, controls 14).
- **Glass** (`components/ui/glass.tsx`): real Liquid Glass on iOS 26 (in Expo Go), blur on older
  iOS, CSS blur on web — for chrome and controls only, never content cards.
- **Tab bar** (iOS 26 style): a floating glass capsule with Home · Activity · Friends · Reports and
  a lens that springs to the selected tab, plus Add as its own round gradient button to the right,
  the capsule's height. (Centred-in-5-slots read as off-centre; don't go back.)
- Gradients come from `components/ui/gradient.tsx`, which measures its box — never size an SVG
  canvas with "100%" (it clipped the hero on iOS). Headless-Chrome screenshots show a thin strip
  on the hero's right edge (it measures before hiding its scrollbar) — not a real-device bug.
- React Compiler: don't write `obj!.prop` inside callbacks — the compiler reads it eagerly as a
  memo dependency and crashes when `obj` is null. Guard instead.
- Colour never carries meaning alone; every screen works in light and dark; sentence case;
  Indian number format.
- Home order: header (official logo + "BUD" wordmark · BUD AI · insights · avatar) → balance groups (first on the gradient, with safe
  to spend until payday) → quick actions → payment-method cards → bank-sync card → top insight →
  friends summary → this week → recent → expenses tiles → monthly budget → upcoming → goals.

## Product rules that must not regress

- Money is integer paise in the app, `numeric(18,2)` in SQL. Balances are maintained by triggers
  from the opening balance plus every transaction; the client can't write `current_balance`.
- **Cash and credit never add up together automatically.** Totals come from user-defined balance
  groups (`balance_groups`, `balance_group_accounts`); cash-type methods add their balance, cards
  contribute owed and available credit — a limit is never cash (`lib/balance-groups.ts`).
- Payday "money month" (`cycle_start_day` 1–28) drives Home, budgets, insights and reports.
- Bank sync = bank SMS forwarded by an iPhone Shortcut → `ingest-sms` → `ingest_bank_sms()`. iOS
  gives apps **no access to SMS**; history comes only from an iPhone backup
  (`scripts/import-iphone-sms.ts`). Low confidence (unknown or ambiguous account) → Review, never
  a guess; duplicates are refused by message hash. Transfers and card-bill payments are never
  spending. Imported history never moves today's balance. The iPhone Message automation needs a
  **Message Contains** word (one automation each for debited / credited / spent / Rs.) — it can't
  run for every text. `ingest_keys.last_used_at` null = the phone has never reached the server.
- **Friends money model** (`20261007000200_friends.sql`): double-entry on the existing ledger.
  Each user has one system account, "Friends" (`system_kind = 'friends'`, other_asset). Payer:
  expense = own share + transfer bank→Friends for the rest. Participant: expense of their share
  from Friends. Settlement: transfers bank↔Friends on each side. Personal spending = your share;
  bank balances = real money; Friends balance = net owed. Each user books only their own side.
  All writes go through SECURITY DEFINER functions; RLS limits reads to participants; nobody can
  read another user's accounts, transactions or profile row. Person-to-person balances cover
  non-group items; group debts live in `group_balances()` (fewest-payments plan may route money).
- **BUD AI** (`app/(app)/assistant.tsx`, engine in `lib/assistant/` — `language.ts` understands,
  `engine.ts` answers; data via `services/assistant.ts`) runs **entirely in the app: no LLM, no API
  key, nothing sent to an AI company** (Charan's decision, Oct 8 — he didn't want a general-purpose
  key). It reads with the app's report functions plus `ai_search_transactions` / `ai_friends`
  under the user's login, and every number in a reply comes from those lookups. Changes are
  proposals; the app performs them via existing functions only after Confirm. Missing details
  (category, account, friend, which transaction) are asked with tap options (`§need:id` values).
  It understands the phrasings it was built for — extend `language.ts`/`engine.ts` with tests
  (`tests/assistant.test.ts`). `ai_take_quota` / `ai_requests` are unused leftovers of the earlier
  Claude version.
- Privacy: OTPs, promotions and personal texts are never stored; sync keys and the app passcode
  are stored only as hashes; the service-role key never ships in the app; **`.env` is never
  committed**. Never store bank login credentials.

## Before saying a task is done

```powershell
npm run format:check
npm run verify          # tsc + eslint (0 warnings) + Jest
npm run test:db         # throwaway Postgres; no Docker here — use a scratch cluster (initdb + pg_ctl on port 5433) and TEST_DATABASE_URL
npm run bundle:ios      # Metro production bundle
```

Look at UI changes rendered (`npx expo start --web`, or on the phone) in both themes before
calling them finished.

## Working with Charan

- He's a senior SQL Server DBA: direct, catches mistakes fast, wants honest assessments and
  production-quality work, not surface fixes.
- Always say **where** a change lives (which files, committed or not, pushed or not). Commit and
  push when asked; he pulls on his laptop.
- Give Windows/PowerShell commands, and say the order steps must run in (migrations before
  publishing JS).
