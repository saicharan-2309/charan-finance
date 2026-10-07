# Charan Finance — project brief for Claude Code

@AGENTS.md

A private personal-finance app for one person (Charan, in India), built to be better than
Emma (the UK budgeting app) in design and at least equal in features. Read this file and
`README.md` before changing anything; this file is the short version of every decision so far.

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

Expo SDK 57, React Native 0.86, React 19.2, TypeScript strict, Expo Router (`src/app/`),
TanStack React Query, Supabase JS. Check versioned Expo docs before touching any Expo API
(see AGENTS.md).

```
src/app/            screens (Expo Router). (tabs)/: Home, Transactions, Reports, Goals, More
src/components/ui/  primitives.tsx (Text, Card, Row, Icon, MoneyText…), controls.tsx (Button,
                    Chip, TextField, ListRow…), layout.tsx (Screen, Section), pickers.tsx
                    (SelectSheet…), feedback.tsx (EmptyState, Skeleton, Toast, AnimatedMoney)
src/components/charts/  hand-built SVG charts
src/features/       feature components (dashboard/MoneyMonthHero, bank-sync/FoundAccounts…)
src/theme/tokens.ts THE design system — colours, type, spacing, radius, elevation, chart palette
src/hooks/data.ts   every React Query hook; src/lib/query.ts the query keys
src/services/       Supabase calls + mappers (snake_case rows → domain types in src/types)
src/lib/            pure logic (money in paise, dates, payday cycles, parsers) — unit-tested
supabase/migrations SQL, applied in filename order; additive only, never destructive
supabase/functions  Edge Functions (Deno). _shared/bank-sms.ts is the SMS parser (also used by the app)
scripts/            import-iphone-sms.ts (history import from an iPhone backup), icon generator
tests/              Jest (136). supabase/tests/ — SQL tests against a disposable Postgres (67)
```

## Design system — "violet glass" (Apple-grade, since Oct 2026)

All values live in `src/theme/tokens.ts`; components read them via `useTheme()` (which also
returns scheme-aware `elevation`). Never hard-code a colour, size or font.

- Canvas: cool lavender-grey `#F3F3F8` (dark `#0A0A0F`) with **borderless** white cards (dark
  `#18181F`) that float on soft, wide, accent-tinted shadows in light mode and lift by tone in
  dark. Grouped lists use hairline dividers inset to the text, like iOS Settings.
- **Layout follows Charan's reference** (a Dribbble finance concept: "Home" with total balance, a
  violet bank-card carousel, a "This week" bar chart, per-transaction cards; "Monthly budget" with
  a coral arc gauge, "Left today / Spent today", period pills and gradient category tiles). Match
  it closely; don't drift back to a generic layout.
- One accent: iris violet `#5B3FD9` (dark `#A193FF`). Payment methods are gradient bank cards
  (`accountGradients`, assigned in order), category tiles use `tileGradients`, the weekly chart
  uses `income` (blue) and `expense` (coral) with a legend. Amber `#FFC14D` marks the review
  badge. The coral → amber `gaugeGradient` is only for progress against a limit
  (`components/charts/Gauge.tsx`). Gradients come from `components/ui/gradient.tsx`, which
  measures its box — never size an SVG canvas with "100%" (it clipped the hero on iOS).
- Categories and charts use banknote inks (₹50 blue, ₹200 marigold, ₹100 lavender, ₹20 olive,
  ₹2000 magenta, ₹10 chocolate, teal; ₹500 stone for "Other"). The order is validated for
  colour-blind separation in both modes — don't reorder or cycle it; fold extras into "Other".
- Type: the **system face only** (San Francisco on iPhone), Apple's text-style ramp; big money is
  SF bold with tight tracking; every number in a list uses tabular figures. (The Bricolage font
  package is still installed but no longer loaded.)
- Shape: continuous (squircle) corners via `continuous`; radius follows hierarchy (hero 30, cards
  22, controls 14, buttons/chips/segmented control are capsules). Icon badges are tinted squircles.
- Tab bar (as in the reference): a white glass bar, icons only — active tab a solid ink glyph,
  others grey outlines — with Add as a violet gradient square in the middle. Every tab keeps its
  VoiceOver name.
- **Glass for controls** (`components/ui/glass.tsx`): real Liquid Glass on iOS 26 (expo-glass-effect,
  in Expo Go), system blur on older iOS, CSS blur on web. Used for the tab bar, segmented-control
  track, unselected chips, round header buttons, toasts and the passcode keypad — never for content
  cards. Switches are the native iOS switch (Liquid Glass on iOS 26). Selected plain chips are solid
  ink capsules; the segmented thumb springs.
- Colour never carries meaning alone: money always has a sign or label, chart series are named.
- Every screen must work in **light and dark**; check both. Contrast is checked in `tokens.ts`.
- Sentence case everywhere, Indian number format (₹1,24,499).
- Home order: header (insights · "Home" · avatar) → total balance (liquid accounts) with a
  "Safe to spend … · …/day until payday" pill → payment-method card carousel → bank-sync card →
  This week (income/expense by day, tap for exact values) → Recent (one card per transaction,
  grouped by day) → Expenses (Today/1W/1M/1Y pills + gradient category tiles) → Monthly budget
  (arc gauge, left today, spent today, then category rows) → upcoming → goals.
- Budgets screen: per budget, title + Edit pill, big gauge, category limit rows; Expenses panel.

## Product rules that must not regress

- Money is integer paise in the app, `numeric(18,2)` in SQL. Balances are maintained by triggers;
  the client can't write `current_balance`.
- Payday "money month" (`cycle_start_day` 1–28) drives Home, budgets and report presets.
- Bank sync = bank SMS forwarded by an iPhone Shortcut → `ingest-sms` → `ingest_bank_sms()`.
  Transfers between own accounts and card-bill payments are never spending. Unknown accounts wait
  in Review → "Found in your messages" (add or link in one tap). Imported history never moves
  today's balance.
- Privacy: OTPs, promotions and personal texts are never stored; texts from phone numbers are
  never bank alerts; sync keys stored only as SHA-256; the service-role key never ships in the
  app; **`.env` is never committed** (only `.env.example`). Never store bank login credentials —
  the legitimate route to direct bank data is Account Aggregator via a licensed partner.

## Before saying a task is done

```powershell
npm run format:check
npm run verify          # tsc + eslint (0 warnings) + Jest
npm run test:db         # needs a throwaway Postgres: docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
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
