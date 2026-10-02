# Charan Finance

A private personal finance app for iPhone, built with **Expo (SDK 57) + React Native + TypeScript** on a **Supabase** backend (PostgreSQL, Auth, Storage, Edge Functions, Row Level Security).

You develop it on **Windows** and build it for iOS **in the cloud with EAS**. You don't need a Mac or Xcode.

---

## Contents

1. [What's inside](#1-whats-inside)
2. [Architecture](#2-architecture)
3. [Prerequisites (Windows)](#3-prerequisites-windows)
4. [Supabase setup](#4-supabase-setup)
5. [Environment variables](#5-environment-variables)
6. [Local development](#6-local-development)
7. [EAS setup & iOS builds](#7-eas-setup--ios-builds)
8. [TestFlight deployment](#8-testflight-deployment)
9. [Receipt OCR (optional)](#9-receipt-ocr-optional)
10. [Testing & quality checks](#10-testing--quality-checks)
11. [Development seed data](#11-development-seed-data)
12. [Security model](#12-security-model)
13. [Troubleshooting](#13-troubleshooting)
14. [Known limitations](#14-known-limitations)

---

## 1. What's inside

| Area                | Features                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Home**            | Total (liquid) balance, net worth, income / expenses / saved this month, savings rate, available balance after card dues and upcoming bills, insights, budgets, upcoming payments, category donut, 6-month trend, top merchants, goals, recent transactions                                                                                                              |
| **Transactions**    | Expense / income / transfer; category + subcategory, merchant, account, date & time, notes, tags, receipts; create / edit / duplicate / delete; global search (merchant, notes, category, account, tags, amount); filters by type, date, category, account, merchant and amount range; sort; day grouping; incremental loading (40 rows per page)                        |
| **Add expense**     | Opens straight into the amount field. Recent categories, merchants and accounts are one tap away. The last-used account is preselected, and a known merchant fills in its usual category. Floating **+** on every tab; long-press it for income, transfer or a receipt scan                                                                                              |
| **Accounts**        | Bank, savings, cash, credit/debit cards, wallets, investments, loans, other assets/liabilities. Last 4 digits only. Opening/current balance, credit limit and utilisation, archive, reconcile to a real balance (recorded as an auditable adjustment)                                                                                                                    |
| **Categories**      | 28 defaults (20 expense, 8 income) with subcategories. Create, rename, recolour, re-icon, classify as essential/discretionary, archive. Deletion is blocked by the database when history exists                                                                                                                                                                          |
| **Merchants**       | Auto-created from transactions (case-insensitive). Lifetime total, count, average, largest, monthly chart, category mix, history. Rename, merge, archive                                                                                                                                                                                                                 |
| **Budgets**         | Weekly / monthly / yearly / custom periods with any start day (for example salary-to-salary). Overall and per-category limits. Spent, remaining, % used, projected spend, a time-elapsed marker on each bar, warnings                                                                                                                                                    |
| **Goals**           | Target, starting amount, contributions and withdrawals, target date, linked account. Remaining, required monthly/weekly saving, recent pace, projected completion, on-track status                                                                                                                                                                                       |
| **Recurring**       | Income, bills, subscriptions, transfers (for example SIPs). Daily to yearly, every N periods, start/end dates. Templates are stored separately from transactions. Mark paid (or a different amount), skip, or auto-record. An occurrence can never be posted twice                                                                                                       |
| **Subscriptions**   | Monthly and annual cost, breakdown by category, upcoming renewals, active/inactive toggle                                                                                                                                                                                                                                                                                |
| **Calendar**        | Month grid of actual daily activity plus **projected** recurring items. Projected month-end and lowest balance, 30+ day projected-balance chart (always labelled as a projection)                                                                                                                                                                                        |
| **Reports**         | Any range (this/last month, 3/6 months, this/last year, custom). Income vs expenses, cumulative cash flow, savings rate, average per day and per month, previous-period and year-over-year comparison, categories (drill-down), merchants, accounts, essential vs discretionary, recurring and subscription share, largest expenses, budget performance, net worth trend |
| **Net worth**       | Assets − liabilities from real balances. A daily snapshot is taken automatically. Trend chart; investment values are never invented                                                                                                                                                                                                                                      |
| **Insights**        | Descriptive statements computed from your data only (no advice)                                                                                                                                                                                                                                                                                                          |
| **Receipts**        | Camera, photo library or PDF. Images are compressed, stored in a private bucket under `<user_id>/…`, viewed through 5-minute signed links. OCR suggests merchant, amount, date, currency and category; **you confirm before anything is saved**                                                                                                                          |
| **Import / export** | CSV import with full validation and preview. Rows with errors are listed and nothing is imported silently, and an interrupted import can be resumed without duplicates. CSV export and a full JSON backup                                                                                                                                                                |
| **Notifications**   | Local reminders for bills, subscription renewals, budget thresholds (once per period), goal check-in and the monthly summary, each with its own toggle. Amounts never appear on the lock screen                                                                                                                                                                          |
| **Security**        | Face ID / Touch ID / passcode app lock. The screen is hidden in the app switcher. The session is stored in the Keychain. Account deletion is available in-app                                                                                                                                                                                                            |
| **Offline**         | Cached data shows instantly. New transactions, edits and deletes made offline are queued durably and synced later; conflicts are detected, and rejected writes are kept for you to review rather than dropped                                                                                                                                                            |
| **Design**          | Light, dark and automatic themes, a token-based design system, Dynamic Type, VoiceOver labels, reduced-motion support, skeleton/empty/error states                                                                                                                                                                                                                       |

---

## 2. Architecture

```
src/
  app/                 Expo Router routes (screens only)
    _layout.tsx        Providers + protected route groups
    (auth)/            sign-in, sign-up, forgot-password
    (app)/(tabs)/      Home, Transactions, Reports, Goals, More
    (app)/…            detail/edit screens, settings
  components/          UI kit (primitives, controls, feedback, layout, pickers), charts, tab bar
  features/            feature-specific components (dashboard widgets, filters, recurring, receipts…)
  hooks/               React Query hooks, session bootstrap
  lib/                 pure, tested business logic: money, dates, recurrence, budgets, goals,
                       cash-flow projection, insights, CSV, receipt parser, errors, offline queue
  providers/           Auth, App lock
  services/            Supabase data access (the only place that talks to the backend)
  theme/               design tokens + theme provider
  types/               domain types
supabase/
  migrations/          versioned SQL: schema, triggers, RPCs, reports, RLS, storage
  functions/           Edge Functions: receipt-ocr, delete-account
  seed/                development-only demo data (never runs automatically)
  tests/               SQL test suite + Supabase shim for plain PostgreSQL
tests/                 Jest unit tests
```

**Key design decisions**

- **Money never touches floating point.** The database uses `NUMERIC(18,2)`. The app works in integer paise and sends exact decimal strings to the server (`src/lib/money.ts`).
- **Balances are kept by the database.** Triggers update `accounts.current_balance` atomically with every insert, update and delete, and clients have no write privilege on that column. A transfer debits one account and credits the other, and is excluded from income/expense everywhere. `verify_account_balances()` recomputes everything from scratch, and the app exposes this under Security → Verify.
- **Atomic, idempotent writes.** `save_transaction` creates or updates a transaction, resolves the merchant and syncs tags in one database transaction. Creates are keyed by a client UUID, so a replay from the offline queue is a no-op, and edits carry `expectedUpdatedAt` for conflict detection.
- **Defence in depth for isolation.** RLS on every table, **composite foreign keys** `(id, user_id)` so a user can't reference someone else's account or category even by guessing a UUID, column-level grants for derived values, and no anon access at all.
- **Recurring = templates.** Occurrences are computed (`recurrence_occurrences`, mirrored exactly in TypeScript), never pre-generated. Posting is idempotent through a `unique(recurring_id, recurring_occurrence)` constraint.
- **Reports are SQL.** Aggregations run in PostgreSQL in the user's timezone, so the phone never loads thousands of rows.

---

## 3. Prerequisites (Windows)

1. **Node.js 22 LTS** (20.19+ also works): <https://nodejs.org/>. Use the Windows installer and tick "Add to PATH".
   ```powershell
   node -v   # v22.x
   npm -v
   ```
2. **Git for Windows**: <https://git-scm.com/download/win>
3. **An editor**: VS Code is recommended.
4. **Expo account** (free): <https://expo.dev/signup>
5. **EAS CLI** (run without a global install):
   ```powershell
   npx eas-cli@latest --version
   ```
6. **Supabase account** (free tier works): <https://supabase.com>
7. **Supabase CLI** (optional, but the easiest way to push migrations):
   ```powershell
   npm i -g supabase      # or: scoop install supabase
   supabase --version
   ```
8. **Apple Developer Program** membership ($99/year) for TestFlight and App Store builds. Development builds on your own iPhone also need it.
9. **An iPhone**, with the **Expo Go** app for quick UI previews (see §6 for what works in Expo Go).

> Expo is **not** installed globally. Every command uses `npx expo …`, which runs the version pinned in this project.

---

## 4. Supabase setup

### 4.1 Create the project

1. In the Supabase dashboard, choose **New project**. Pick a region close to you (for example _Mumbai — ap-south-1_), set a strong database password, and save it in a password manager.
2. Wait for the project to finish provisioning.

### 4.2 Apply the database migrations

**Option A: Supabase CLI (recommended)**

```powershell
cd charan-finance
supabase login
supabase link --project-ref YOUR-PROJECT-REF     # the ref is in your project URL
supabase db push                                  # applies supabase/migrations in order
```

**Option B: SQL Editor (no CLI)**
Open **SQL Editor → New query**, then paste and run each file in `supabase/migrations/` **in filename order**:

```
20261001000100_core_schema.sql
20261001000200_integrity_and_balances.sql
20261001000300_rpc_functions.sql
20261001000400_views_and_reports.sql
20261001000500_row_level_security.sql
20261001000600_storage_receipts.sql
```

The last file creates the private `receipts` bucket (10 MB limit; images and PDFs only) and its storage policies.

Verify: **Table Editor** should show the tables with RLS enabled, and **Storage** should show a private `receipts` bucket.

### 4.3 Configure Auth

In **Authentication → URL Configuration**:

- **Site URL**: `charanfinance://`
- **Redirect URLs**: add `charanfinance://**`
  (For development in Expo Go, also add `exp://**`.)

In **Authentication → Providers → Email**:

- Keep **Email** enabled.
- **Confirm email**: recommended ON. New users must click the emailed link before signing in.
- Optional: enable **leaked password protection** under Auth → Settings.

> Supabase's built-in email sender is heavily rate-limited (a few emails per hour). For real use, configure custom SMTP under **Auth → SMTP Settings** (for example Resend, Brevo or Amazon SES).

### 4.4 Deploy the Edge Functions

```powershell
supabase functions deploy delete-account
supabase functions deploy receipt-ocr
```

- `delete-account` is required for in-app account deletion, which App Store rules demand. It uses the service role key that Supabase injects automatically on the server; the key never ships in the app.
- `receipt-ocr` returns "not configured" until you add an OCR key (see §9). Receipts still upload and attach without it.

### 4.5 Get your public keys

Go to **Project Settings → API** and copy the **Project URL** and the **anon / publishable key**.
**Never** copy the `service_role` / secret key into the app or `.env`.

---

## 5. Environment variables

Copy the example file and fill it in:

```powershell
copy .env.example .env
```

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-OR-PUBLISHABLE-KEY
```

- `EXPO_PUBLIC_*` values are compiled into the app. That's correct for the anon key, because RLS is what protects the data.
- `.env` is git-ignored. Never commit it.
- If the variables are missing, the app shows a "Configuration needed" screen instead of crashing.

---

## 6. Local development

```powershell
npm install
npm run start          # Metro dev server; scan the QR code with your iPhone camera
```

If your phone and PC aren't on the same network, or Windows Firewall blocks the connection:

```powershell
npm run start:tunnel
```

**Expo Go vs. a development build.** Most of the app runs in Expo Go: auth, every screen, charts, the offline cache, receipts from the library or camera, and local notifications. Face ID app lock needs a **development build**, and so does the exact production behaviour of native modules. Build one once (§7.3) and install it on your iPhone; after that, `npm run start` serves code to it just like Expo Go.

Useful scripts:

| Command                                              | What it does                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `npm run start` / `start:tunnel`                     | Start the dev server                                          |
| `npm run android`                                    | Start for Android (optional; the app is iOS-first)            |
| `npm run typecheck`                                  | TypeScript strict check                                       |
| `npm run lint`                                       | ESLint (zero warnings allowed)                                |
| `npm run format` / `format:check`                    | Prettier                                                      |
| `npm run test`                                       | Jest unit tests                                               |
| `npm run test:db`                                    | SQL tests against a **disposable** local PostgreSQL (see §10) |
| `npm run verify`                                     | typecheck + lint + tests                                      |
| `npm run bundle:ios`                                 | Production iOS JS bundle (proves the app compiles)            |
| `npm run doctor`                                     | expo-doctor                                                   |
| `npm run db:push`                                    | `supabase db push`                                            |
| `npm run functions:deploy`                           | Deploy both Edge Functions                                    |
| `npm run build:dev` / `build:preview` / `build:prod` | EAS iOS builds                                                |
| `npm run submit:ios`                                 | Submit the latest production build to App Store Connect       |

---

## 7. EAS setup & iOS builds

All iOS compiling and signing happens on Expo's macOS build servers.

### 7.1 Log in and link the project

```powershell
npx eas-cli@latest login
npx eas-cli@latest init          # creates the EAS project and writes its id into app.json
```

### 7.2 Add environment variables to EAS

Cloud builds don't see your local `.env`. Add the two public variables once for each environment:

```powershell
npx eas-cli@latest env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR-REF.supabase.co --environment development --environment preview --environment production --visibility plaintext
npx eas-cli@latest env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value YOUR-ANON-KEY --environment development --environment preview --environment production --visibility plaintext
```

(You can also do this on expo.dev → your project → **Environment variables**.) Each profile in `eas.json` selects its environment.

### 7.3 Apple credentials (handled by EAS)

You need an **Apple Developer Program** account. On your first iOS build, EAS asks for your Apple ID, then creates and stores the distribution certificate and provisioning profiles for you:

```powershell
npx eas-cli@latest build --profile development --platform ios
```

- Answer **Yes** to "Log in to your Apple account" and "Generate a new Apple Distribution Certificate / Provisioning Profile".
- For **development** and **preview** (internal) builds, register your iPhone once:
  ```powershell
  npx eas-cli@latest device:create
  ```
  Open the link on your iPhone to install the profile, then rebuild.
- Credentials live on Expo's servers. Nothing secret goes into this repo. Manage them with `npx eas-cli@latest credentials`.
- The bundle identifier is `com.charan.finance`. If it's already taken in your Apple account, change `ios.bundleIdentifier` in `app.json` before the first build.

### 7.4 Build profiles (`eas.json`)

| Profile       | Use                                                                    |
| ------------- | ---------------------------------------------------------------------- |
| `development` | Dev client for your registered iPhone; loads JS from `npm run start`   |
| `preview`     | Standalone internal build for registered devices (install via QR/link) |
| `production`  | App Store / TestFlight build; the build number auto-increments         |

```powershell
npm run build:dev
npm run build:preview
npm run build:prod
```

When a build finishes, EAS shows a link and QR code. Open it on your iPhone to install development or preview builds. On iOS 16+, enable **Settings → Privacy & Security → Developer Mode** when prompted.

---

## 8. TestFlight deployment

1. Create the app record: **App Store Connect → Apps → + → New App**. Choose iOS, name it "Charan Finance", and pick bundle id `com.charan.finance` (created automatically by EAS during the first build) with any SKU.
2. Build and submit:
   ```powershell
   npm run build:prod
   npm run submit:ios          # or: npx eas-cli@latest submit --platform ios --latest
   ```
   EAS asks for your Apple ID, or an **App Store Connect API key**, which is recommended (create one under _Users and Access → Integrations → App Store Connect API_). Choose "Let EAS manage" and the key is stored on Expo's servers, not in the repo.
3. In App Store Connect, open the build under **TestFlight**. Once processing finishes (10–30 minutes), add yourself as an internal tester. Install the **TestFlight** app on your iPhone and accept the invite.
4. Before an App Store review: complete _App Privacy_ (data linked to the user: email, financial info, photos for receipts; no tracking) and give the reviewers a demo account.

Over-the-air JS updates (optional): `npx eas-cli@latest update --channel production` ships JS-only changes without a new build.

---

## 9. Receipt OCR (optional)

The `receipt-ocr` Edge Function sends the user's private image to **Google Cloud Vision** (`DOCUMENT_TEXT_DETECTION`) and returns plain text. The app parses that text locally into a suggestion (`src/lib/receipt-parser.ts`, unit-tested), and you confirm it in the form.

1. In Google Cloud Console, enable the **Cloud Vision API** and create an **API key** restricted to that API.
2. Store the key as a Supabase secret, never in the app:
   ```powershell
   supabase secrets set GOOGLE_VISION_API_KEY=your-key
   supabase functions deploy receipt-ocr
   ```

Without the key, scanning still attaches the receipt and asks you to type the details.

---

## 10. Testing & quality checks

```powershell
npm run verify        # TypeScript strict + ESLint + 58 Jest tests
npm run test:db       # 27 SQL tests (needs a local, disposable PostgreSQL 15+)
npm run bundle:ios    # Metro production bundle for iOS
```

**Unit tests (`tests/`)** cover money parsing, formatting and paise precision; dates and range presets; recurrence (month-end clamping, leap years, intervals, end dates); budget periods and projections; goal maths; net worth; balance effects for create, edit, delete and transfers; cash-flow projection and available balance; insights; CSV parsing, writing and import validation; the receipt parser; error mapping; authentication route guards; and the offline queue (durability, ordering, retry, conflicts, per-user isolation).

**SQL tests (`supabase/tests/database.test.ts`)** create a fresh database, apply a small Supabase shim (auth/storage schemas and roles) plus every migration, then run statements **as real users through the `authenticated` role**. They cover:

- new-user bootstrap (profile, settings, default categories; no demo data);
- balance maintenance on create, edit, account change and delete; opening-balance changes; reconciliation;
- transfers (no income or expense impact) and a **150-operation randomized consistency check**;
- idempotent creates, edit-conflict detection, merchant resolution, tag sync, category validation;
- **RLS isolation across all 15 tables**, blocked cross-user references, no anon access, no forged snapshots or goal amounts, storage folder isolation, attachment path and MIME checks;
- the recurring engine (month-end, weekly, leap-year; post/skip/no duplicates; auto-post idempotency; history kept after template deletion);
- budget periods and timezone-correct sums, goal contributions, net-worth snapshots, dashboard and reports, merchant merge.

Running the SQL tests on Windows: install PostgreSQL 16 from <https://www.postgresql.org/download/windows/> (or use Docker Desktop: `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`), then:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/postgres"
npm run test:db
```

⚠️ Never point `TEST_DATABASE_URL` at your Supabase project. The tests create and drop databases and install a shim.

---

## 11. Development seed data

`supabase/seed/dev_seed.sql` is **not** a migration and never runs automatically. Use it only on a development project:

1. Sign up in the app with a throwaway demo account.
2. In the Supabase SQL Editor, run the whole file. It creates `dev.seed_demo_data`, which is not exposed to the API and not callable by app users.
3. Run `select dev.seed_demo_data('<demo user uuid>');` (find the UUID under Authentication → Users).

This creates HDFC Bank, Cash and HDFC Credit Card; six months of salary, rent, everyday spending, ATM withdrawals and card payments; subscriptions and bills; a monthly budget; and a MacBook goal. It refuses to run for a user who already has transactions.

---

## 12. Security model

- **Authorisation lives in PostgreSQL.** Every table has RLS with `user_id = auth.uid()` policies, and composite foreign keys prevent cross-user references. The anon role has no table or function access.
- **Derived values can't be forged.** Account balances, goal progress and net-worth snapshots are written only by triggers or security-definer functions; clients lack column privileges for them.
- **No secrets in the app or repo.** Only the public anon key is used. The service role key exists only inside Supabase Edge Functions. Apple credentials live in EAS. `.env`, keys, certificates and profiles are all git-ignored.
- **Session in the Keychain.** It's chunked and stored `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, and it's cleared, along with the cached data and offline queue, on sign-out.
- **Safe uploads.** The client compresses images; storage enforces a 10 MB limit and allowed MIME types; the database checks size, MIME and that the path is under the user's own folder; receipts are only reachable through short-lived signed URLs.
- **Input validation.** It happens in the forms, then in database CHECK constraints and validation triggers. Raw database errors are mapped to friendly messages (`src/lib/errors.ts`). Logs are development-only and never include amounts, notes or tokens.
- **No financial credentials.** The app never asks for bank passwords, UPI PINs, card numbers or CVVs; it stores only an optional last four digits.

---

## 13. Troubleshooting

| Problem                                | Fix                                                                                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Configuration needed" screen          | `.env` is missing or wrong (locally), or the EAS environment variables aren't set for that profile. Restart with `npx expo start --clear`                                                                   |
| Phone can't connect to Metro           | Use `npm run start:tunnel`; allow Node.js through Windows Firewall; make sure the phone and PC are on the same Wi-Fi                                                                                        |
| Sign-up email never arrives            | Supabase's default mailer is rate-limited. Check spam, or set up custom SMTP (§4.3)                                                                                                                         |
| Email link opens Safari, not the app   | The link only opens the app in a development, preview or TestFlight build with the `charanfinance` scheme. Check the Redirect URLs (§4.3)                                                                   |
| Face ID option disabled                | Expo Go doesn't support it; use a development build. Also check that Face ID or a passcode is set up on the phone                                                                                           |
| "permission denied for table …"        | A migration didn't apply. Re-run `supabase db push`, or run the missing SQL file                                                                                                                            |
| Receipt scan says OCR not set up       | Expected until `GOOGLE_VISION_API_KEY` is set (§9)                                                                                                                                                          |
| Account deletion fails                 | Deploy the `delete-account` function (§4.4)                                                                                                                                                                 |
| EAS: "bundle identifier not available" | Change `ios.bundleIdentifier` in `app.json` to something unique, for example `com.yourname.charanfinance`                                                                                                   |
| EAS: device can't install the build    | Register it with `eas device:create`, rebuild, and enable Developer Mode on the iPhone                                                                                                                      |
| `npm install` errors on Windows        | Delete `node_modules` and `package-lock.json` only as a last resort, then `npm install`. Use Node 22 LTS, and keep the project path short (for example `C:\dev\charan-finance`) to avoid path-length issues |
| Dependency version warnings            | `npx expo install --fix`, then `npm run doctor`                                                                                                                                                             |
| Wrong day in reports when travelling   | The profile timezone follows the device and updates on the next app launch                                                                                                                                  |

---

## 14. Known limitations

- **No Mac, so no iOS Simulator.** You test on a real iPhone through Expo Go, a development build or TestFlight. Every native iOS build runs on EAS's macOS servers, and the free EAS plan has a queue and a monthly build quota.
- **Apple Developer membership is required** for anything beyond Expo Go: development builds on your own phone, TestFlight and the App Store.
- **Face ID** can only be tested in a development, preview or TestFlight build.
- **Multi-currency.** Accounts can use any currency, and each is tracked exactly. Dashboard, report and net-worth totals include only accounts in your default currency; no exchange rates are invented. Transfers between currencies aren't supported yet. The schema is ready for a `currency_rates` table.
- **Investments** are valued manually (Reconcile on the account). No market data is fetched.
- **OCR** needs a Google Cloud Vision key (§9). PDFs are attached but not text-scanned.
- **Receipts attached while offline** aren't queued. Save offline, then attach the receipt from the transaction once you're online.
- **Reminders** are local notifications, scheduled when the app opens; there's no push server.
- **Imports** run row by row through the safe `save_transaction` RPC. Thousands of rows take a while, but an interrupted import can be resumed without creating duplicates.
