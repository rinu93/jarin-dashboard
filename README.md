# JARIN Fitness Studio · Employee Dashboard

Staff-only dashboard: members, enquiries (with chatbot transcripts), attendance, payroll with leave and
loss of pay, targets, expenses vs income, equipment, team logins, and Excel backup and restore.
Roles: Owner/Admin, Manager, Trainer, Receptionist.

## 1. Database (Supabase)
`database.sql` is already applied to the Supabase project **JARIN GYM WEBSITE** (`yuvcjkdinbmjwfjwbxeb`), upgraded from v2.
For a brand-new project, paste it into Supabase → SQL Editor and run it (safe to run again).

In Supabase → Authentication → URL Configuration:
- **Site URL**: your dashboard URL, e.g. `https://jarin-dashboard.vercel.app`
- **Redirect URLs**: add `https://jarin-dashboard.vercel.app/**` and `https://jarin-website.vercel.app/**`

Invitation and password emails use Supabase's built-in sender (a few per hour). For regular use, add your
own SMTP under Authentication → Emails → SMTP Settings.

## 2. Deploy on Vercel
Import this repository (preset **Vite**) with:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://yuvcjkdinbmjwfjwbxeb.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the project's anon key |

Set the website address in `config.js` (`WEBSITE_URL`).

## 3. First login
The **first account created becomes the Owner**. Sign up on the dashboard with the owner's email first,
then invite staff from **Team & logins**. An owner who accepts another invitation keeps the Owner role.

## 4. Backup and restore
- **Backup & restore → Download backup** saves every table to one Excel file (README sheet, one sheet per table, hidden `_meta`).
- **Restore**: drop a backup file, check the preview counts, confirm. Rows that already exist are skipped, never overwritten,
  and member / employee codes continue from the highest restored code. Restored members are credited to the Owner who restored them.

## Website content, offers and themes (Owner and Manager)
- **Website content:** plans, fees, benefits, extra services, opening hours, hero facts and terms shown on the website.
  "Reset" goes back to the JARIN fee guide values.
- **Offers:** type (seasonal, students, special packages, referral rewards), badge, highlight, start and end dates, and
  price rows written as `Plan | old price | offer price`.
- **Themes & visuals:** workout themes for the website background, the Employee Dashboard theme (same as website, one
  theme for everyone, each person picks, or plain), and which logo animations rotate.

## IDs, owner profile and recovery
- IDs are automatic: members **JFS-M-0001**, employees **JFS-E-0001**, owner **JFS-O-0001** (prefixes in Gym settings).
- Employee records are for staff only. The owner has a separate owner profile, can't be linked to an employee
  record, and their access never ends.
- **Owner recovery PIN:** the owner sets it in Logins & Access. If the owner loses their password or email, a
  Manager opens **Owner recovery**, enters the PIN and either sends a reset link or sets a new owner email and
  password. 5 wrong tries lock it for 30 minutes; every attempt is shown to the owner. This uses the Supabase Edge
  Function `owner-recovery` (source in `supabase/functions/owner-recovery`).

## Welcome note and invoice
After registering a member, starting a website sign-up's first plan, or recording a renewal, the dashboard opens the
invoice (number like INV-2026-00001) with **Email**, **WhatsApp**, **Print / Save as PDF** and **Copy message**.
Members can also open their invoices in the Member portal.

## Local development
```bash
npm install
npm run dev
```
