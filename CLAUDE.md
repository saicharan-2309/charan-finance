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
tests/              Jest (127). supabase/tests/ — SQL tests against a disposable Postgres (67)
```

## Design system — "rupee ink on note paper"

All values live in `src/theme/tokens.ts`; components read them via `useTheme()`. Never hard-code
a colour, size or font.

- Surfaces: cool green-grey paper `#F1F3EE` with white cards. Text and the Home hero: deep indigo
  ink (`#161D36`, hero `#18213F`). Actions: indigo `#3442B0`. Marigold `#F2B441` is a sparing
  highlight (today on the pace track, the review badge).
- Categories and charts use banknote inks (₹50 blue, ₹200 marigold, ₹100 lavender, ₹20 olive,
  ₹2000 magenta, ₹10 chocolate, teal; ₹500 stone for "Other"). The order is validated for
  colour-blind separation in both modes — don't reorder or cycle it; fold extras into "Other".
- Type: **Bricolage Grotesque** (600/700/800) only for big money figures and screen titles;
  system font for body; every number in a list uses tabular figures.
- Colour never carries meaning alone: money always has a sign or label, chart series are named.
- Every screen must work in **light and dark**; check both.
- Radius follows hierarchy (hero roundest, then cards, then controls). Lift comes from contrast
  with the paper, not heavy shadows. Sentence case everywhere, Indian number format (₹1,24,499).
- Home order: money-month hero (safe to spend, per day, pace vs last month, In/Out/Kept) → bank
  card → accounts strip → upcoming → spending → recent → budgets → goals.

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
