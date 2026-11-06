# Symptom Tracker

A shared phone diary for logging a child's suspected absence **events**, bedwetting and day notes, with a PDF report for the paediatrician. Two or more carers each have their own account and see each other's entries straight away.

- `src/index.html` is the whole app. `build.mjs` copies it and `public/` into `dist/` for Netlify.
- `supabase/schema.sql` sets up the database, access rules and invite codes.
- `test/` has an end-to-end test that runs two "phones" against a stand-in server (`npm test`).

## Privacy

The database never holds the child's name, date of birth, NHS number or doctor. A diary is just a random id. Those details are typed into each device (More tab), kept in that device's storage, and only added to the PDF when it is made. Carers appear by the label they choose, such as "Dad". Avoid using the child's name in free-text notes. Video is not stored; there is just a "video taken, sent separately" tick.

## One-off setup

1. **Supabase database.** In the Supabase dashboard open **SQL Editor**, choose **New query**, paste all of `supabase/schema.sql` and press **Run**. It is safe to run again after updates.
2. **Supabase sign-in.** Open **Authentication**, then **Sign In / Providers**, then **Email**, and turn **Confirm email** off, then save. (Supabase's built-in email only reaches your own team, so confirmation emails would not arrive. Without an invite code nobody can see any diary.)
3. **Netlify.** Choose **Add new project**, **Import an existing project**, GitHub, then `symptom-tracker`. The build settings come from `netlify.toml`, so just deploy. No environment variables are needed: the Supabase URL and publishable key are built in (they are designed to be public), and can be overridden with `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
4. **Phones and iPad.** Open the Netlify address in Safari, tap **Share**, then **Add to Home Screen**.
5. **Accounts.** The first parent creates an account, chooses **Start a new diary**, then in **More** makes an invite code. The other parent creates their own account and chooses **Join with a code**. Each code works once and lasts 7 days.

## Using it

- **Event now**: tap when it starts and "It's over" when it ends. The time and seconds are saved immediately; add details then or later.
- **Brief event**: one tap for the 2 to 3 second ones, then pick how sure you are.
- **Log a past event**, **Bedwetting** and **Day note** open a form. "Seen by" lets you log what a grandparent saw.
- **Report**: pick dates and make the PDF, then share it to Mail.
- Works without signal: entries wait on the phone and sync when you are back online.

## Deploys

Netlify's free plan has a monthly credit allowance shared across the whole account, and each live deploy uses some. Group changes into fewer pushes to `main`.
