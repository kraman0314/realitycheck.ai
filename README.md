# RealityCheck AI

A full-stack startup validation app with a muted, autoplay 20-second product film on each site entry, followed by a sassy public landing page and a sign-in-gated Founder Desk. The opening film is served as H.264 MP4 with VP9 WebM fallback; users can skip it, and reduced-motion preferences bypass autoplay. A separate 12-second brand intro is also available under `public/videos/`. After login, the Overview stays compact: basic workspace stats, simple New idea / Ask Advisor actions, and recent reports. The six-agent explanation and inline forms live on their dedicated pages instead of adding long scroll sections to Overview. Users can switch between warm light and deep-green dark themes; the choice persists in local storage. The free plan is capped at five reports and twenty substantive Advisor replies per Asia/Kolkata calendar month. Paid plans are displayed as coming soon; no checkout or charges are active.

## Current integrations

- **Supabase Auth + Postgres** are connected to the active `realitycheck-ai` Supabase project. RLS policies isolate each founder's ideas, reports, and monthly usage. Atomic server-side credits are stored in `public.monthly_usage`; migration `monthly_usage_credits_and_caps` enforces five reports and twenty Advisor replies per month. `schema.sql` documents the schema.
- **Google AI Studio / Gemini** runs only from the Node backend. Gemini is configured through `GEMINI_API_KEY` and `GEMINI_MODEL`; the key is not sent to browser code. If Gemini is temporarily unavailable, the app falls back to its transparent structured analysis so the workflow can finish.
- **Reports** include six specialist perspectives, validation score, assumptions, evidence to gather, risks, and prioritized experiments. The PDF button opens the browser print dialog; choose **Save as PDF**.

## Run locally

Requires Node 20+.

```bash
npm install
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, GEMINI_API_KEY and SESSION_SECRET.
npm start
```

Open http://localhost:3000. The workspace already has an ignored `.env` for the connected preview. `.env` is in `.gitignore`; never paste either API key into `public/` or commit the `.env` file. The served `public/index.html` is a self-contained preview bundle (inline CSS/JS, so the sandbox can render it); edit `public/index.template.html`, `public/styles.css`, and `public/app.js`, then run `npm run build`. On each normal site entry, the muted 20-second product video plays before the landing page; skip is available, and reduced-motion preferences bypass it.

## Supabase setup

The current connected project is named `realitycheck-ai` in the `ap-south-1` region. Tables and RLS policies have been applied there:

- `public.ideas`: idea brief and owner
- `public.reports`: structured agent results, score, verdict, and owner
- `public.monthly_usage`: per-user report and Advisor counters for the Asia/Kolkata calendar month; atomic `consume_monthly_usage` RPC enforces the free limits

The server accepts Supabase access tokens in the `Authorization` header and validates them against Supabase Auth before any private API call. This avoids the session-cookie issue that caused a successful login to be treated as signed out in the embedded preview. Token refresh is handled through the backend. User-owned database reads/writes run with the user's JWT and RLS; no service-role key is used.

For the preview project, email auto-confirm is enabled so signup can return a session immediately without relying on SMTP delivery. Before a public production launch, configure SMTP, allow the production redirect URLs, and enable email confirmation if you want verified addresses.

## Gemini / Google AI Studio

The backend calls Google's `generateContent` API with the Gemini model configured in `.env`. Agent outputs are requested as JSON (summary, findings, confidence); the Advisor uses the same private backend integration. If the model returns a temporary 429/503, the server retries briefly and then uses the built-in fallback. The server health endpoint at `/api/health` reports only whether an AI provider is configured—not any secret values.

## Main app flow

1. Visitors see the public landing page. All workspace routes require an authenticated Supabase session.
2. Create an account or sign in. Tokens are stored in browser storage and sent as bearer tokens; expired access tokens are refreshed through `/api/auth/refresh`.
3. Submit an idea. The server verifies the user, and Supabase RLS saves it under that user.
4. The War Room runs six role-specific analyses and persists the completed report in Supabase.
5. View/search report history, compare reports, or export a PDF from the report screen.
6. Ask the AI Advisor a question. Substantive responses use one Advisor credit; greetings and thanks are free. Responses are generated server-side and never call Gemini directly from frontend code.
7. Open **Plans & usage** to see remaining credits and the reset date. Paid plans are currently a non-billing placeholder while pricing and checkout are undecided.

## API routes

- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/refresh`, `GET /api/auth/me`
- `POST /api/ideas`, `GET /api/ideas`
- `POST /api/ideas/:id/analyze`
- `GET /api/reports`, `GET /api/reports/:id`
- `GET /api/usage` (authenticated)
- `POST /api/advisor`
- `GET /api/health`

## Test checklist

1. Open the app in a fresh tab: the landing page appears; internal pages are not accessible until sign-in.
2. Create a new account, then confirm the workspace/dashboard loads and the user name is shown.
3. Navigate to **Validate an idea**, submit a 30+ character brief and target customer, and watch the six agent states.
4. Open the resulting report and verify all six agent findings, evidence, assumptions, risks, and recommendations.
5. Visit **My reports**, search, select two reports, and use **Compare selected**.
6. Open **AI advisor**, ask a question, then reload. The refreshed session should keep the user signed in.
7. Try an incorrect password, too-short description, and invalid message to verify errors are surfaced.
8. Use **Export PDF** and select *Save as PDF* in the browser print dialog.

The validation score is a heuristic synthesis of agent confidence, not an objective market statistic or investment recommendation. The app does not claim live competitor or market research unless a separate verified data source is added.
