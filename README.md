# KB Movement

The booking website for KB Movement youth soccer training.

- **Home page**: the weekly schedule, prices, what to bring, Winter Select and FAQs.
- **Booking**: parents answer "What would you like to book?" (group training or a private 1-on-1) and "How old is your player?", and the site shows only the right sessions. Wednesday, Thursday and Friday sessions appear one week per row. Booking all three days in a week applies the $159.99 week price automatically. Full sessions can't be booked, and simultaneous bookings can never overbook a session.
- **Payments**: all sessions are paid in advance. The site runs in **demo mode** until Stripe keys are added: everything works, but no card is charged.
- **Winter Select**: invite-only enrollment. The coach creates a personal code in the dashboard and texts or emails it. The family enters the code, reads the commitment and signs. Each code works once. Tournaments are hosted by Soccer Coliseum.
- **Coach dashboard** (`/#coach`): rosters with parent contacts, booking cancellations, invite codes, the Winter Select team list and days off.

| Session | Time (Wed, Thu, Fri) | Price |
|---|---|---|
| Group, ages 8–11 | 5:00–6:15 PM | $59.99 drop-in, or $159.99 for all 3 days in a week |
| Group, ages 12–14 | 6:15–7:30 PM | $59.99 drop-in, or $159.99 for all 3 days in a week |
| 1-on-1, any age | 7:30–8:45 PM | $99.99 |

Group sessions take up to 15 players. Times are US Eastern.

## Put it online with Vercel

1. **Import the project.** In Vercel, choose **Add New → Project**, pick the `KB-Movement` GitHub repository and click **Import**. Leave the build settings as they are; `vercel.json` takes care of them.
2. **Set your coach password.** Before clicking Deploy, open **Environment Variables** and add `ADMIN_PASSWORD` with a password of your choice. Then click **Deploy**.
3. **Add the database.** In the new project, open the **Storage** tab, choose **Neon** (free plan) and create a database. When asked, connect it to this project for all environments. This adds `DATABASE_URL` for you.
4. **Redeploy.** Open **Deployments**, click the menu on the latest deployment and choose **Redeploy**, so the site picks up the database.
5. **Check it.** Visit `https://YOUR-SITE.vercel.app/api/health`. It should say `"database":"postgres"`. Then open the site, make a demo booking, and sign in at `/#coach` with your password to see it on the roster.

Optional: add `PUBLIC_URL` (your site's address) so Winter Select invite messages include the link, then redeploy.

Every push to the `main` branch redeploys the site automatically.

## Switch on real payments later

1. In Stripe (Developers → API keys), copy the secret key into a Vercel environment variable named `STRIPE_SECRET_KEY`.
2. In Stripe, add a webhook endpoint at `https://YOUR-SITE/api/stripe/webhook` with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.expired`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. In Stripe, open Settings → Customer emails and turn on receipts for successful payments.
4. Redeploy. The demo banner disappears and parents pay through Stripe Checkout (card, Apple Pay, Google Pay).

Tip: try it with your `sk_test_…` key and Stripe's test card `4242 4242 4242 4242` before switching to the live key.

## Change details

Prices, capacity, times and text live in `lib/config.js`. Most of them can also be changed with an environment variable in Vercel, with no code change. See `.env.example` for the full list:

| What | Variable |
|---|---|
| Business name | `BUSINESS_NAME` |
| Drop-in, week and 1-on-1 prices (in dollars) | `PRICE_DROP_IN`, `PRICE_WEEK_BUNDLE`, `PRICE_PRIVATE` |
| Players per group session | `GROUP_CAPACITY` |
| Field location, contact email and phone | `LOCATION`, `CONTACT_EMAIL`, `CONTACT_PHONE` |
| Weeks open for booking | `WEEKS_AHEAD` |
| How long before a session online booking closes (minutes) | `BOOKING_CUTOFF_MINUTES` |

The Winter Select commitment wording is in `lib/config.js`.

**Photos:** put `.jpg`, `.png` or `.webp` files in `public/photos/` and push. The first one replaces the illustration at the top of the home page, and the rest appear in an "At training" section.

## Day to day

- **See who's coming:** go to `/#coach`, sign in, and tap a session to see the roster with parent phone numbers and emails.
- **Take a day off:** in the Days off tab, pick the date (all sessions or just one). It shows as unavailable on the calendar.
- **Cancel a booking:** cancel it in the dashboard to free the spot. Once real payments are on, refund the parent in Stripe.
- **Invite a Winter Select player:** in the Winter Select tab, enter the player's name (and optionally the parent's email or mobile), create the code, and copy the ready-made message into a text or email.

## Run it on your computer

Requires Node.js 22.

```bash
npm install
cp .env.example .env    # then set ADMIN_PASSWORD
npm run dev             # http://localhost:3000
```

With no `DATABASE_URL`, the site uses a built-in local database stored in `data/pglite`.

```bash
npm test                # bookings, week pricing, capacity, holds, codes, coach sign-in
```

## How it's built

- `server.js`: Express API (bookings, Stripe Checkout and webhook, Winter Select, coach sign-in with a signed cookie)
- `api/index.js` and `vercel.json`: run the API as a Vercel serverless function and serve `public/` from Vercel's CDN
- `lib/store.js`: Postgres database (Neon on Vercel, or the built-in PGlite locally)
- `public/core.js`: schedule, pricing and validation rules, shared by the browser and the server
- `public/app.js`, `public/graphics.js`, `public/styles.css`: the website and its illustrations, with no front-end framework
- `preview/` and `scripts/build-preview.js`: build a single-file demo in which everything runs in the browser (`npm run build:preview`)
- `Dockerfile`: for hosts other than Vercel. Mount a volume at `/data`, or set `DATABASE_URL`.
