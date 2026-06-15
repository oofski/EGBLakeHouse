# EBG Lake House — Microsoft 365 Sync Setup (for IT / M365 admin)

This guide turns the two static pages (`booking.html`, `admin.html`) into a **shared,
multi-user system** where every employee's booking and every blocked date is stored in
**your own Microsoft 365 tenant** — not in each person's browser.

**How it will work once set up**
- Each user signs in with their existing Microsoft 365 account (single sign-on) via
  Microsoft's MSAL library.
- Bookings and blocked dates are stored in **SharePoint Lists**.
- Driver's license / boating license images and signatures are stored in a **SharePoint
  document library** (so ID photos stay inside your tenant).
- The pages talk to **Microsoft Graph** using the signed-in user's permissions.

Until this is configured, the app keeps working in its current per-browser mode, so nothing breaks in the meantime.

---

## What IT needs to do (one time)

### Step A — Create the SharePoint storage
On the SharePoint site you want to use (e.g. an "EBG Lake House" team site):

1. **List 1 — `EBG Bookings`** with these columns:
   | Column | Type |
   |---|---|
   | `BookingId` | Single line of text |
   | `Status` | Choice: `pending`, `approved`, `rejected`, `deleted` |
   | `RenterName` | Single line of text |
   | `Email` | Single line of text |
   | `CheckIn` | Date |
   | `CheckOut` | Date |
   | `SubmittedAt` | Date and time |
   | `DataJson` | Multiple lines of text (plain text) — holds the full booking record |

2. **List 2 — `EBG Blocked Dates`** with:
   | Column | Type |
   |---|---|
   | `BlockDate` | Date |
   | `Reason` | Single line of text |

3. **Document library — `EBG Documents`** — stores the uploaded ID photos and signatures
   (the app files them in a folder per booking).

### Step B — Register the app in Microsoft Entra ID (Azure AD)
1. **Entra admin center → App registrations → New registration**
   - Name: `EBG Lake House Booking`
   - Supported account types: **Accounts in this organizational directory only** (single tenant)
   - **Platform: Single-page application (SPA)** — add these Redirect URIs:
     - `https://oofski.github.io/EGBLakeHouse/booking.html`
     - `https://oofski.github.io/EGBLakeHouse/admin.html`
     - `https://oofski.github.io/EGBLakeHouse/`
     - *(and the SharePoint page URLs too, if you later move hosting into SharePoint)*
2. **API permissions → Add → Microsoft Graph → Delegated**:
   - `User.Read`
   - `Sites.ReadWrite.All`  *(or, for least privilege, `Sites.Selected` granted to just the one site)*
   - Click **Grant admin consent**.
3. From the app **Overview**, copy the **Application (client) ID** and **Directory (tenant) ID**.

### Step C — Find the Site ID
In [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer), signed in as your admin, run:
```
GET https://graph.microsoft.com/v1.0/sites/{your-tenant}.sharepoint.com:/sites/{your-site-path}
```
Copy the `id` value it returns (looks like `contoso.sharepoint.com,GUID,GUID`).

---

## Step D — Send these 5 values back to complete the wiring
1. **Tenant ID** (Directory ID)
2. **Client ID** (Application ID)
3. **Site ID** (from Step C)
4. The two **List names** (default: `EBG Bookings`, `EBG Blocked Dates`)
5. The **document library name** (default: `EBG Documents`)

Once I have these, I drop them into a small `CONFIG` block at the top of both pages,
switch the storage layer from "browser" to "Microsoft 365," and we test together with a
real booking end-to-end.

---

### Notes & decisions for IT
- **Least privilege:** prefer `Sites.Selected` scoped to just the EBG site over
  `Sites.ReadWrite.All` if your security posture requires it.
- **Who can approve:** the admin page should only be usable by approvers — we can gate it
  by Entra group membership (tell us the group name) in addition to the page password.
- **Hosting:** the app currently lives on GitHub Pages (public URL, code is public, data is
  not). If you'd rather host the pages inside SharePoint itself, that's also supported and
  can simplify sign-in — let us know and we'll adjust the redirect URIs.
- **Data residency:** all booking data and ID images stay in your SharePoint site; nothing
  is stored outside your tenant.
