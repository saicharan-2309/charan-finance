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
   - [8a. Running without a dev server, for free](#8a-running-without-a-dev-server-for-free)
   - [8b. Upgrading an app that is already running](#8b-upgrading-an-app-that-is-already-running)
9. [Receipt OCR (optional)](#9-receipt-ocr-optional)
   - [9a. Automatic bank sync](#9a-automatic-bank-sync)
10. [Testing & quality checks](#10-testing--quality-checks)
11. [Development seed data](#11-development-seed-data)
12. [Security model](#12-security-model)
13. [Troubleshooting](#13-troubleshooting)
14. [Known limitations](#14-known-limitations)

---

## 1. What's inside

| Area                | Features                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**            | **Safe to spend until payday** (balance after card dues and bills due before your next salary) with a per-day figure, and a pace track comparing this month's spending with last month at the same point; money in, out and kept; anything bank sync wants checked; account tiles (cards show limit used); upcoming payments; spending by category; recent transactions; budgets; goals                                                                                                                                                                                 |
| **Bank sync**       | Bank alert SMS become transactions automatically (§9a). Matched to the right account by its last digits, de-duplicated, linked to anything you already typed in, auto-categorised by merchant, and — the part most apps get wrong — **transfers between your own accounts, credit-card bill payments and ATM withdrawals are recorded as transfers, never as spending**. OTPs, promotions and personal texts are discarded and never stored. Each account shows the balance the bank last reported, with one tap to match it                                            |
| **Review inbox**    | Everything bank sync added, waiting for a glance: confirm it, or change the category and the merchant is filed that way from then on. Messages it couldn't place (a card it doesn't know yet, a bill payment with no matching card) wait here for one tap, and the digits are remembered                                                                                                                                                                                                                                                                                |
| **Auto-categorise** | ~290 built-in rules for the merchants people in India pay (Swiggy, Zomato, Blinkit, Uber, IRCTC, BESCOM, Airtel, LIC, Zerodha…) plus your own. A merchant you corrected always wins; among rules, the longest match wins                                                                                                                                                                                                                                                                                                                                                |
| **Money month**     | Pick your payday and Home, budgets and the month presets in Reports run payday to payday instead of 1st to 31st                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Transactions**    | Expense / income / transfer, with a transfer into a credit card shown as a **card payment** — it reduces what you owe and is never counted as spending; category + subcategory, merchant, account, date & time, notes, tags, receipts; create / edit / duplicate / delete; global search (merchant, notes, category, account, tags, amount); filters by type, date, category, account, merchant, amount range and source (bank SMS, not yet checked, entered by you); **split a payment across categories**; sort; day grouping; incremental loading (40 rows per page) |
| **Add expense**     | Opens straight into the amount field. Recent categories, merchants and payment methods are one tap away, the payment-method picker shows each balance (and what is used and left on a card), and a new method can be added without leaving the form. The last-used method is preselected, and a known merchant fills in its usual category. The **+** button offers expense, income, transfer or card payment, EMI, a new payment method, or a receipt scan; long-press it to go straight to Add Expense                                                                |
| **Payment methods** | Bank and savings accounts, credit and debit cards, cash, UPI apps (Google Pay, PhonePe, Paytm, Amazon Pay, other), investments, loans, other assets/liabilities — grouped by kind, each asking only for the fields its own type needs. Last 4 digits only. Opening/current balance; for a card, credit limit, **calculated** available credit, statement day, due day and minimum due. Archive, or reconcile to a real balance (recorded as an auditable adjustment)                                                                                                    |
| **EMIs & loans**    | Total loan amount, monthly instalment, interest rate, tenure, lender, start date — paid from **any** payment method, bank or card or UPI or cash. Each EMI drives a monthly schedule, so it appears in Upcoming, the calendar and reminders. Progress (paid, remaining, instalments left) is counted from instalments actually recorded, never estimated                                                                                                                                                                                                                |
| **Categories**      | 28 defaults (20 expense, 8 income) with subcategories. Create, rename, recolour, re-icon, classify as essential/discretionary, archive. Deletion is blocked by the database when history exists                                                                                                                                                                                                                                                                                                                                                                         |
| **Merchants**       | Auto-created from transactions (case-insensitive). Lifetime total, count, average, largest, monthly chart, category mix, history. Rename, merge, archive                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Budgets**         | Weekly / monthly / yearly / custom periods with any start day (for example salary-to-salary). Overall and per-category limits. Spent, remaining, % used, projected spend, a time-elapsed marker on each bar, warnings                                                                                                                                                                                                                                                                                                                                                   |
| **Goals**           | Target, starting amount, contributions and withdrawals, target date, linked account. Remaining, required monthly/weekly saving, recent pace, projected completion, on-track status                                                                                                                                                                                                                                                                                                                                                                                      |
| **Recurring**       | Income, bills, subscriptions, transfers (for example SIPs). Daily to yearly, every N periods, start/end dates. Templates are stored separately from transactions. Mark paid (or a different amount), skip, or auto-record. An occurrence can never be posted twice                                                                                                                                                                                                                                                                                                      |
| **Subscriptions**   | Monthly and annual cost, breakdown by category, upcoming renewals, active/inactive toggle, and **subscriptions found in your spending** — merchants charged on a steady rhythm for a steady amount — tracked in one tap                                                                                                                                                                                                                                                                                                                                                 |
| **Calendar**        | Month grid of actual daily activity plus **projected** recurring items. Projected month-end and lowest balance, 30+ day projected-balance chart (always labelled as a projection)                                                                                                                                                                                                                                                                                                                                                                                       |
| **Reports**         | Any range (this/last month, 3/6 months, this/last year, custom). Income vs expenses, cumulative cash flow, savings rate, average per day and per month, previous-period and year-over-year comparison, categories (drill-down), merchants, accounts, essential vs discretionary, recurring and subscription share, largest expenses, budget performance, net worth trend                                                                                                                                                                                                |
| **Net worth**       | Assets − liabilities from real balances. A daily snapshot is taken automatically. Trend chart; investment values are never invented                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Insights**        | Descriptive statements computed from your data only (no advice)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Receipts**        | Camera, photo library or PDF. Images are compressed, stored in a private bucket under `<user_id>/…`, viewed through 5-minute signed links. OCR suggests merchant, amount, date, currency and category; **you confirm before anything is saved**                                                                                                                                                                                                                                                                                                                         |
| **Import / export** | CSV import with full validation and preview. Rows with errors are listed and nothing is imported silently, and an interrupted import can be resumed without duplicates. CSV export and a full JSON backup                                                                                                                                                                                                                                                                                                                                                               |
| **Notifications**   | Local reminders for bills, subscription renewals, budget thresholds (once per period), goal check-in and the monthly summary, each with its own toggle. Amounts never appear on the lock screen                                                                                                                                                                                                                                                                                                                                                                         |
| **Security**        | Face ID / Touch ID / passcode app lock. The screen is hidden in the app switcher. The session is stored in the Keychain. Account deletion is available in-app                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Offline**         | Cached data shows instantly. New transactions, edits and deletes made offline are queued durably and synced later; conflicts are detected, and rejected writes are kept for you to review rather than dropped                                                                                                                                                                                                                                                                                                                                                           |
| **Design**          | "Rupee ink on note paper": cool note-paper surfaces, a deep indigo-ink hero, and category and chart colours taken from the inks of Indian banknotes (₹50 blue, ₹200 marigold, ₹100 lavender, ₹20 olive, ₹2000 magenta, ₹10 chocolate), checked for colour-blind separation and contrast. Bricolage Grotesque for big figures and titles, the system face (tabular figures) for everything else. Light, dark and automatic themes, animated category avatars, Dynamic Type, VoiceOver labels, reduced-motion support, skeleton/empty/error states                        |

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
  lib/                 pure, tested business logic: money, dates, recurrence, payment methods,
                       budgets, goals, cash-flow projection, insights, CSV, receipt parser,
                       errors, offline queue
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
- **One table for every way money moves.** A bank account, a card, cash and a UPI app are all rows in `accounts`, and a transaction points at one of them. Nothing in the app is special-cased for credit cards: a card is a type with three extra fields. `lib/payment-methods.ts` decides which fields a type needs, so a Cash account is never asked for a credit limit, and available credit is always **derived** from the limit and the balance rather than stored.
- **Category tells you why, payment method tells you how.** They are separate columns, separate pickers and separate filters, all the way from the schema to the UI.
- **A card payment is a transfer, not an expense.** Paying a bill from a bank account moves money between two of your own accounts: the debt falls, the bank balance falls, and reported spending does not change. The destination account's type is what makes it a "card payment", so the label stays right for transactions recorded before the feature existed.
- **An EMI is an agreement plus a schedule.** `loans` holds the principal, rate and tenure; a normal recurring transaction posts the instalments, charged to whichever payment method you chose. That means EMIs reuse the existing due-date, reminder, calendar and posting machinery instead of a second copy of it, and progress is counted from instalments actually recorded. Totals shown (instalment × tenure, and that minus the principal) are exact arithmetic, never an amortisation guess.
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
20261003000100_payment_methods_and_loans.sql
20261004000100_bank_sync.sql
20261004000200_banknote_palette.sql
```

`20261001000600` creates the private `receipts` bucket (10 MB limit; images and PDFs only) and its storage policies.

`20261003000100` adds payment-method identity (UPI/wallet provider), credit-card
billing and due dates, the `loans` table behind EMIs, and the softer default
category colours. It is **additive and safe to run on a database that already
holds your data**: no column is dropped or retyped, no row is deleted, and a
category colour is refreshed only where it still holds the exact factory
default — any colour you changed yourself is left alone. Run it the same way as
the others; if you are already using the app, this is the only file you need to
apply.

`20261004000100` adds automatic bank sync: the sync key table, the bank
message log, account aliases, auto-categorise rules (with the built-in Indian
merchant rules seeded for every existing user), payday-based months, split
transactions and subscription detection. `20261004000200` moves the default
category colours to the banknote palette — again only where a colour is still
the exact previous default. Both are additive: nothing you already have is
changed or removed.

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
npx supabase functions deploy delete-account --use-api
npx supabase functions deploy receipt-ocr --use-api
npx supabase functions deploy ingest-sms --use-api --no-verify-jwt
```

`--use-api` bundles on Supabase's servers, so Docker isn't needed on Windows.

- `delete-account` is required for in-app account deletion, which App Store rules demand. It uses the service role key that Supabase injects automatically on the server; the key never ships in the app.
- `receipt-ocr` returns "not configured" until you add an OCR key (see §9). Receipts still upload and attach without it.
- `ingest-sms` receives bank SMS from your iPhone Shortcut (§9a). It must be deployed with `--no-verify-jwt`: a Shortcut has no Supabase login, so the function checks your personal sync key instead.

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

Over-the-air JS updates: `npx eas-cli@latest update --channel production` ships JavaScript-only changes without a new build. `expo-updates` is installed and `runtimeVersion` uses the `sdkVersion` policy, so published updates also load in Expo Go — see §8a.

---

## 8a. Running without a dev server, for free

No Apple Developer membership and no laptop. Publish the JavaScript to Expo's servers and open it in Expo Go:

```powershell
npx eas-cli@latest login
npx eas-cli@latest init                 # once, if you have not already
npx eas-cli@latest update:configure     # once: writes updates.url into app.json
npx eas-cli@latest update --branch main --message "first publish"
```

The last command prints a QR code and a link. Scan it once with your iPhone camera and the project appears under **Recently opened** in Expo Go, loading from Expo's CDN rather than your PC. Your laptop can be off.

Each later change is one command:

```powershell
npx eas-cli@latest update --branch main --message "what changed"
```

Expo Go picks it up on the next cold start. The `sdkVersion` runtime policy is what makes this work — it pins the bundle to Expo SDK 57, which is the runtime Expo Go provides. Native changes (a new module, anything in `app.json`) still need a real build.

Trade-offs against a native build: you launch through Expo Go rather than your own icon, Expo Go has to stay installed, and startup is a second or two slower. Everything else — your data, offline queue, reminders, receipts — behaves the same.

---

## 8b. Upgrading an app that is already running

If the app is already on your phone, this is the whole upgrade:

1. **Get the code** — `git pull` in your `charan-finance` folder, then
   `npm install` (this release adds two packages: the Bricolage Grotesque font
   and `expo-clipboard`; both run in Expo Go).
2. **Apply the new migrations.** Run `npx supabase db push`, or paste each new
   file from `supabase/migrations/` into the SQL Editor, oldest first. For this
   release that is `20261004000100_bank_sync.sql`, then
   `20261004000200_banknote_palette.sql`. They only add things — your
   accounts, transactions and balances are untouched.
3. **Deploy the bank-sync function** (once). The first time, log the CLI in
   and link it to your project; after that, only the last line is needed:
   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase functions deploy ingest-sms --use-api --no-verify-jwt
   ```
   Your project ref is the part before `.supabase.co` in your project URL.
4. **Publish the new JavaScript.**
   ```powershell
   npx eas-cli@latest update --branch main --message "bank sync, review inbox, redesign"
   ```
   Choose the **preview** environment when asked.
5. **Reopen the app** (fully close it first). It fetches the new bundle on launch.
   Then follow §9a to switch on bank sync.

Do them in that order: the new screens read the new tables, so the migrations
go first. If you publish first, the app will show errors until they are applied.

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

## 9a. Automatic bank sync

India's account-data network (Account Aggregator) only gives data to companies
regulated by RBI, SEBI, IRDAI or PFRDA, so a personal app can't connect to
banks the way UK Open Banking apps do. What every Indian bank and card issuer
_does_ do, by RBI rule, is send an SMS for every debit and credit within
seconds. Bank sync reads those.

**How it works**

```
Bank SMS ─▶ iPhone Shortcut ─▶ ingest-sms Edge Function ─▶ ingest_bank_sms() ─▶ your ledger
            (on your phone)     checks your sync key,        matches the account,
                                parses the text              skips duplicates,
                                                             pairs transfers,
                                                             categorises, flags for review
```

- **Parsing** (`supabase/functions/_shared/bank-sms.ts`, 39 unit tests) handles
  the formats of HDFC, ICICI, SBI, Axis, Kotak, IDFC, Federal, PNB, Amex and
  others: UPI, card, ATM, NEFT/IMPS, mandates, refunds, salary and interest. It
  reads the amount separately from the "Avl Bal" figure, and ignores OTPs,
  declined payments, "will be debited" notices, statements and promotions.
- **Matching** uses the last digits in the SMS against each account's last 4
  (and any extra digits you've told it about, such as a debit card on a savings
  account). Two possible accounts is never guessed at — it goes to Review.
- **Duplicates**: the same SMS twice, the same UPI reference on the same
  account, and a transaction you already typed in by hand (same account and
  amount within two days) are all recognised.
- **Not spending**: a debit and a credit with the same reference on two of your
  accounts become one transfer; a CRED/BillDesk/"credit card payment" debit and
  the card's "payment received" become one card payment; ATM cash moves into a
  Cash account.
- **Privacy**: every text your phone receives passes through your own Supabase
  function, but only bank transactions and balance updates are stored. OTPs,
  promotions and personal messages are discarded on arrival. The sync key is
  stored only as a SHA-256 hash; turning sync off revokes it instantly.

**Set up (once, ~3 minutes)**

1. Deploy the function (§4.4 / §8b) and apply the migrations.
2. In the app: **More → Bank sync → Turn on bank sync**. It shows an address
   and a sync key with copy buttons, and step-by-step Shortcut instructions.
3. On the iPhone: **Shortcuts → Automation → + → Message**, leave Sender and
   Message Contains empty, **Run Immediately**, **New Blank Automation**, add
   **Get Contents of URL** with the address, method **POST**, header
   `x-sync-key` = your key, and a JSON body with `text` = Shortcut Input ›
   Content and `sender` = Shortcut Input › Sender.
4. Tap **Test connection** in the app, then make any small UPI payment.
5. Make sure each bank account and card in the app has its **last 4 digits**
   set — the Bank sync screen lists any that don't.

Older history isn't in your SMS inbox's reach: for months before you switched
sync on, use **More → Import CSV** with your bank's statement export.

---

## 10. Testing & quality checks

```powershell
npm run verify        # TypeScript strict + ESLint + 119 Jest tests
npm run test:db       # 58 SQL tests (needs a local, disposable PostgreSQL 15+)
npm run verify:all    # both of the above
npm run bundle:ios    # Metro production bundle for iOS
```

**Unit tests (`tests/`)** cover money parsing, formatting and paise precision; dates and range presets; recurrence (month-end clamping, leap years, intervals, end dates); budget periods and projections; goal maths; net worth; balance effects for create, edit, delete and transfers; cash-flow projection and available balance; insights; CSV parsing, writing and import validation; the receipt parser; error mapping; authentication route guards; the offline queue (durability, ordering, retry, conflicts, per-user isolation); and payment methods — credit-card standing (used, available, utilisation, overpaid), which fields each type needs, grouping, billing-date clamping (the same cases as the SQL `day_in_month`), and card-payment detection.

**SQL tests (`supabase/tests/`)** create a fresh database, apply a small Supabase shim (auth/storage schemas and roles) plus every migration, then run statements **as real users through the `authenticated` role**. They cover:

- new-user bootstrap (profile, settings, default categories; no demo data);
- balance maintenance on create, edit, account change and delete; opening-balance changes; reconciliation;
- transfers (no income or expense impact) and a **150-operation randomized consistency check**;
- idempotent creates, edit-conflict detection, merchant resolution, tag sync, category validation;
- **RLS isolation across all the original tables**, blocked cross-user references, no anon access, no forged snapshots or goal amounts, storage folder isolation, attachment path and MIME checks;
- the recurring engine (month-end, weekly, leap-year; post/skip/no duplicates; auto-post idempotency; history kept after template deletion);
- budget periods and timezone-correct sums, goal contributions, net-worth snapshots, dashboard and reports, merchant merge;
- **payment methods**: five types side by side with only their own fields populated, an expense from each one, statement/due-day validation, `current_balance` still unwritable with the new columns in place, billing-cycle computation, and the proof that paying a card bill from a bank account does **not** increase reported spending;
- **EMIs**: a loan paid from a bank account and another from a credit card, progress counted from posted instalments, exact `instalment × tenure`, the loan record surviving deletion of its schedule, amount and rate validation, and loan isolation between users;
- **bank sync** (`bank-sync.test.ts`): real bank SMS through the same parser, ingested exactly as the Edge Function does — only the service role may ingest, unknown keys are refused, expenses are created and auto-categorised, duplicates and OTPs never create anything (and an OTP is never stored), a hand-entered expense is linked not duplicated, transfers between your own accounts and card-bill payments are never counted as spending (with one card, and with two cards where the payment waits for the card's own SMS), ATM cash moves to a Cash account, unknown digits are learnt once assigned, a card payment from an untracked account becomes a correction not income, another user can't see or assign your messages, corrected categories are remembered per merchant, splits keep balances unchanged, monthly subscriptions are detected, and every balance still reconciles;
- the development seed (`seed.test.ts`): it applies against the real schema, spends from every payment method, leaves no balance drift, and refuses to run over real data.

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
- **Apple Developer membership ($99/year) is required** for any app installed as its own icon on an iPhone: development builds, preview builds, TestFlight and the App Store. Apple issues provisioning profiles for physical devices only to paid members, and the free alternative (personal-team signing) needs Xcode on a Mac. The free way to run without a dev server is Expo Go plus a published update (§8a). One membership covers up to 100 devices, so a family shares one.
- **Face ID app lock** is untested in Expo Go. `expo-local-authentication` is bundled there, so the toggle under More → Security may well work; if it is greyed out, it needs a development build. It is verified to work in a development build.
- **Interest is not amortised.** An EMI shows the instalment, how much has been paid, how many payments are left and the exact difference between `instalment × tenure` and the loan amount. It does not split each payment into principal and interest, and it does not track a declining outstanding principal — those need the lender's own schedule, and inventing them would put wrong numbers in front of you.
- **Android is untested.** Every iOS-only API in the app sits behind a platform check with an Android branch, and `app.json` carries Android config, but the app has only ever been run on iOS. Android needs a test pass before trusting it. An Android APK built through EAS needs no developer account and no fee.
- **Multi-currency.** Accounts can use any currency, and each is tracked exactly. Dashboard, report and net-worth totals include only accounts in your default currency; no exchange rates are invented. Transfers between currencies aren't supported yet. The schema is ready for a `currency_rates` table.
- **Bank sync needs SMS alerts and an iPhone Shortcut.** It can't read SMS already in your inbox (iOS doesn't allow it), so earlier history comes in by CSV import. A bank that only sends email alerts, or an alert format the parser hasn't seen, shows up as a message in Review rather than being guessed at. UPI apps' own wallets (e.g. Paytm wallet balance) don't send bank SMS. An "Ask about my spending" chat assistant isn't included — it would need an AI API key on the server.
- **Investments** are valued manually (Reconcile on the account). No market data is fetched.
- **OCR** needs a Google Cloud Vision key (§9). PDFs are attached but not text-scanned.
- **Receipts attached while offline** aren't queued. Save offline, then attach the receipt from the transaction once you're online.
- **Reminders** are local notifications, scheduled when the app opens; there's no push server.
- **Imports** run row by row through the safe `save_transaction` RPC. Thousands of rows take a while, but an interrupted import can be resumed without creating duplicates.
