# EBG Lake House — Cloudflare (Pages + Functions + D1 + R2)

Cloud version of the Lake House booking system. Bookings live in Cloudflare's
cloud, so anyone can book from any network via the public URL / QR code, and
all bookings appear in a shared admin dashboard.

## Structure

```
cloudflare/
  schema.sql                         D1 tables: bookings, blocked_dates
  wrangler.toml                      Pages config + D1/R2 bindings
  functions/
    api/
      state.js                       GET    /api/state
      bookings.js                    POST   /api/bookings
      bookings/[id].js               PATCH/DELETE /api/bookings/:id
      blocked.js                     POST   /api/blocked
      blocked/[date].js              DELETE /api/blocked/:date
      file/[id]/[slot].js            GET    /api/file/:id/:slot
  public/                            Pages static output (pages_build_output_dir)
    index.html                       Branded landing -> booking / admin
    booking.html                     Booking page (loads cloud-store.js)
    admin.html                       Admin dashboard (loads cloud-store.js)
    cloud-store.js                   window.EBGStore adapter -> the API
```

## Bindings (set in `wrangler.toml` and in the Pages project)

- `DB`    — D1 database, `database_name = "ebg-lakehouse"`
- `FILES` — R2 bucket, `bucket_name = "ebg-lakehouse-files"`

The functions read bindings via `context.env.DB` and `context.env.FILES`.

## Data model

- `bookings` row = indexed columns (id, status, renter_name, email, business,
  purpose, employee_name, check_in, check_out, submitted_at) + `data` (the full
  booking JSON with file bytes stripped out).
- Uploaded files (driver's license, boating license, signature) are stored in
  R2 under the key `${bookingId}/${slot}` and served back via
  `GET /api/file/:id/:slot`. `slot` is one of `driversLicense`,
  `boatingLicense`, `signature`.

## Setup (summary — full end-user guide lives elsewhere)

1. `wrangler d1 create ebg-lakehouse` — copy the returned `database_id` into
   **`wrangler.toml`** (replace `PUT_D1_DATABASE_ID_HERE`). This step is
   required; the app will not work until the real ID is filled in.
2. `wrangler r2 bucket create ebg-lakehouse-files`
3. `wrangler d1 execute ebg-lakehouse --file=./schema.sql --remote`
4. Create the Pages project (build output dir = `public`), and bind `DB` and
   `FILES` in the Pages project settings to match `wrangler.toml`.
5. Deploy. The booking page is at `/booking.html` (and `/`); admin at
   `/admin.html`.

No `wrangler dev`/deploy has been run here — these are source files only.
