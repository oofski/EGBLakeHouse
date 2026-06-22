# EBG Lake House — Desktop App

A small Windows desktop app for the EBG Lake House booking system. It runs on
**one office computer** and turns that computer into a tiny booking server for
your local WiFi.

When you open the app you get the **admin dashboard** in a window, plus a
**QR code** in the corner. Anyone on the **same WiFi** can scan that QR code
with their phone to open the booking page, fill it out, and submit. New bookings
appear **live** in the admin dashboard — no refresh needed.

There is **no cloud and no Microsoft sign-in**. Everything stays on the office
computer in a single local file.

## How an admin runs it

1. Double-click **EBG Lake House** to launch it.
2. The admin dashboard opens. Log in with the admin password (default below).
3. In the bottom-right corner you'll see a card titled
   **"📱 Scan to book on your phone"** with a QR code and a web address
   (for example `http://192.168.1.50:4399/`).
4. Hand the phone holder that QR code (or read them the address). They must be
   on the **same WiFi** as the office computer.
5. They fill out the booking form and submit. It shows up in your dashboard
   instantly, where you can approve or reject it.

**Phones must be on the same WiFi network as the office computer.** Phones on
cellular data, or on a different/guest WiFi, will not be able to reach it.

## Getting the `.exe`

The Windows installer is built automatically by GitHub Actions.

1. In the GitHub repo, open the **Actions** tab.
2. Open the most recent **"Build Windows desktop"** run (or trigger one with
   **Run workflow**).
3. Scroll to **Artifacts** and download **EBG-Lake-House-Windows**.
4. Unzip it. You'll get an installer (`EBG Lake House Setup …exe`) and a
   portable `.exe`. Run the installer on the office computer.

## Admin password

Default admin password: **`EBG2024Admin!`**

(This is the same admin password used by the existing web admin page.)

## Where the data lives & backups

All bookings and blocked dates are stored locally on the office computer in the
app's **user-data folder**, in a single file named `bookings.json`
(typically under `%APPDATA%\EBG Lake House\`). Booking photos and signatures are
stored inline in that file.

To back up, use the **Export** button on the admin dashboard to save a copy of
the bookings. Keep that backup somewhere safe — if the office computer is lost,
the data is lost with it unless you have an export.

## Email notifications for new bookings

Every time someone submits a booking, the app notifies three people —
Jennifer Garcia, Susan Haise, and Bonnie Zeutzius — with a summary of the
booking (renter, dates, guests/vehicles, amenities, and pricing).

**By default (no setup):** when a booking comes in, your **default mail
program opens on the office computer** with a new email already addressed to
all three people and the whole summary filled in. You just review it and hit
**Send**. (This needs a default mail app set up on that computer, e.g. Outlook
or the Windows Mail app.)

**Fully automatic (no clicks):** if you'd rather the email send itself with no
window popping up, create a file named **`settings.json`** in the app's
user-data folder (the same folder that holds `bookings.json`, typically
`%APPDATA%\EBG Lake House\`) with an `smtp` block. The app will then send the
email silently through that mailbox.

Office 365 example (`settings.json`):

```json
{
  "smtp": {
    "host": "smtp.office365.com",
    "port": 587,
    "secure": false,
    "user": "lakehouse@edgelessbeauty.com",
    "pass": "your-app-password-here",
    "from": "lakehouse@edgelessbeauty.com"
  }
}
```

- `user` / `from` should be a real mailbox you control.
- `pass` should be an **app password** (not the normal account password) if the
  mailbox has multi-factor authentication enabled.
- After creating or editing `settings.json`, restart the app.

If the SMTP send ever fails (or `settings.json` is missing), nothing breaks —
the booking is still saved, and the app falls back to opening the pre-addressed
draft for you.

## Running just the server (advanced / testing)

You can run the booking server without the desktop shell:

```
cd desktop
npm install
DATA_DIR=./data PORT=4399 node server.js
```

Then open `http://<computer-ip>:4399/` on a phone (booking page) or
`http://<computer-ip>:4399/admin` for the dashboard.
