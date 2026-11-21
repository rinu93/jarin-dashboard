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

## Local development
```bash
npm install
npm run dev
```
