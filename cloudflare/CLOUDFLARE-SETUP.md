# EBG Lake House — Cloudflare Setup Guide

This deploys the **cloud** version of the booking system: booking + admin pages on
**Cloudflare Pages**, the API on **Pages Functions**, data in **D1** (database), and
uploaded ID photos/signatures in **R2** (file storage). Anyone can book from any
network by scanning the QR — no office computer required.

You'll do this once. It takes ~20–30 minutes. You need a **Cloudflare account**
(free) and, for two steps, the **Wrangler** command‑line tool.

---

## Step 0 — Install Wrangler (the Cloudflare CLI)
On any computer with Node.js installed:
```
npm install -g wrangler
wrangler login
```
`wrangler login` opens your browser to authorize. (You only need Wrangler for
creating the database + loading its schema. Everything else is in the dashboard.)

---

## Step 1 — Create the D1 database
```
wrangler d1 create ebg-lakehouse
```
It prints a block including a **`database_id`** (a long UUID). **Copy it.**

Open `cloudflare/wrangler.toml` and replace `PUT_D1_DATABASE_ID_HERE` with that id.

Now load the tables into the **remote** database (the `--remote` flag is required —
without it you only touch a local test copy):
```
wrangler d1 execute ebg-lakehouse --file=./cloudflare/schema.sql --remote
```

*(Dashboard alternative: Cloudflare dashboard → Storage & Databases → D1 → Create
database `ebg-lakehouse` → open it → Console tab → paste the contents of
`cloudflare/schema.sql` → Run.)*

---

## Step 2 — Create the R2 bucket (for ID photos / signatures)
Dashboard → **R2** → **Create bucket** → name it exactly **`ebg-lakehouse-files`**.
(Cloudflare may ask you to enable R2 first; the free tier is generous. A card on
file may be required to turn R2 on, but normal usage here stays in the free tier.)

*(CLI alternative: `wrangler r2 bucket create ebg-lakehouse-files`)*

---

## Step 3 — Create the Pages project (connected to GitHub)
Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** →
pick the **`oofski/EGBLakeHouse`** repo, then set:
- **Production branch:** `claude/busy-shannon-6xqhrj`
- **Build command:** *(leave empty)*
- **Build output directory:** `public`
- **Root directory (Advanced):** `cloudflare`   ← important: the project lives in the `cloudflare/` subfolder
- Framework preset: **None**

Click **Save and Deploy**. The first deploy will succeed but the API won't work yet
until you add the bindings (next step).

---

## Step 4 — Add the D1 + R2 bindings to the Pages project (critical)
In the Pages project → **Settings** → **Functions** (a.k.a. **Bindings**):
- **D1 database binding:** Variable name **`DB`** → database **`ebg-lakehouse`**
- **R2 bucket binding:** Variable name **`FILES`** → bucket **`ebg-lakehouse-files`**

Add them for **Production** (and Preview if it asks). Then go to **Deployments** →
on the latest deployment choose **Retry deployment** (or push any change) so the
Functions pick up the new bindings.

> The binding **variable names must be exactly `DB` and `FILES`** — the code uses those.

---

## Step 5 — Get your link and the QR
Your project now has a URL like **`https://ebg-lakehouse.pages.dev`** (yours may have
a random suffix — the dashboard shows it).
- **Booking (give this to staff / behind the QR):** `https://<your-project>.pages.dev/booking.html`
- **Admin:** `https://<your-project>.pages.dev/admin.html` — password **`EBG2024Admin!`**

Open the **admin** page: it shows a **"Scan to book"** QR pointing at your booking
URL. Print/post that QR — anyone on **any** internet connection can scan it and book,
and it appears in the admin within ~12 seconds.

---

## Step 6 (optional) — Your own domain
Pages project → **Custom domains** → **Set up a domain** (e.g.
`lakehouse.yourcompany.com`). Cloudflare handles the certificate.

---

## ⚠️ Important security note (please read)
As built, the API endpoints (`/api/...`) are **public and unauthenticated** — the
admin page is only gated by the in‑page password. That means, in theory, someone who
discovered the URLs could read bookings (including the **ID photos**) or post entries.
For an internal tool holding driver's‑license images, you should lock this down:
- **Recommended:** put **Cloudflare Access** (Zero Trust, free for small teams) in
  front of `/admin*` and the read/manage API routes, so only your approved Microsoft/
  Google accounts can reach them. (The booking submit route stays open so staff can
  book without logging in.)
- Tell me when you're ready and I can wire a shared‑secret token or Access policy.

## Other notes
- **Updates:** the web version is always the latest — there's nothing to install or
  auto‑update (that feature is only for the downloadable desktop app).
- **Live updates:** the admin refreshes every ~12 seconds (cloud can't hold a live
  connection the way the local app did).
- **QR images** load from `api.qrserver.com` (a free third‑party QR service) — fine
  online; I can switch to a self‑hosted QR later if you prefer.
- **Data location:** all bookings + ID photos live in your Cloudflare account (D1 + R2).

---

When your project is live, send me the **`*.pages.dev` URL** and I'll confirm
everything resolves and help you lock down access.
