# Setting up Piecewise accounts — plain English

## First: what costs money and what doesn't

**Free, and stays free:**

- People making accounts and signing in
- Saving each person's progress
- Your admin page that shows who uses the app and how much

All of that runs on Supabase's free plan. No credit card.

**Not free:**

- The AI that reads a photo of a worksheet and pulls the questions out.

That one costs a few cents every time somebody takes a picture. Ten testers
using it a lot could cost a few dollars a day.

**What to do about it:** skip it for now. The app already has a backup way to
read photos that runs on the phone itself and costs nothing. It is not as good,
but it works. Ship the free version, see if testers even complain, and only pay
for the AI if they do.

So this guide sets up the free stuff. That's steps 1 to 6.

---

## What Supabase is

It's a website that gives you a place to keep information online, for free.

Right now Piecewise saves everything on the phone it's running on. That means
your progress is stuck on that one phone, and you can't see how anyone is doing.
Supabase fixes both.

---

## Step 1 — Make an account

1. Go to **supabase.com**
2. Click **Start your project**
3. Sign in with GitHub (you already have GitHub, so this is fastest)

## Step 2 — Make a project

1. Click **New project**
2. Name it `piecewise`
3. For the password, click **Generate a password**
4. **Save that password in your password manager.** You won't need it for the
   app. But if you lose it you can't get back into the database directly.
5. Pick the region closest to you
6. Click **Create new project**

Now wait a minute or two while it builds.

## Step 3 — Set up the tables

A table is like one sheet in a spreadsheet. You need two: one for people, one
for what they do. I already wrote them.

1. On the left, click **SQL Editor**
2. Click **New query**
3. Open the file `schema.sql` (it's next to this one)
4. Copy **all** of it, paste it into the box
5. Click **Run**

It should say success. If you run it twice by accident, nothing breaks.

## Step 4 — Turn off email confirming

Piecewise asks people for a username, not an email. So there's no real email to
send anything to. If you skip this step, nobody can sign up — the app will just
sit there waiting forever for an email that goes nowhere.

1. On the left, click **Authentication**
2. Click **Sign In / Providers**
3. Click **Email**
4. Find **Confirm email** and turn it **OFF**
5. Leave **Enable email provider** ON
6. Save

## Step 5 — Copy two things and send them to me

1. On the left, click **Project Settings** (the gear)
2. Click **API**
3. Copy these two:
   - **Project URL** — looks like `https://something.supabase.co`
   - **anon public** key — a really long line starting with `eyJ`

Send me both. These two are safe to share. They're meant to go inside the app
where anyone can see them. That sounds wrong, but it's fine — the rules you set
up in step 3 are what keep people out of each other's data, not hiding these.

## Step 6 — NEVER send these

On that same page there are two things you must keep to yourself:

- **`service_role`** key — it's marked *secret*. This one ignores every rule and
  can read and delete everything. Never paste it anywhere.
- The **database password** from step 2.

Don't put either in the app, in GitHub, or in a message to anyone. Including me.

If you ever paste one by accident, go to that page and click to reset it.

## Step 7 — Make yourself the boss (do this last)

After I've put the new code in and you've signed up in the app once:

1. Go back to **SQL Editor**
2. Paste this, but put your own username in the quotes:

```sql
update public.profiles set is_admin = true where username = 'your_username';
```

3. Click **Run**

Now you can see everyone's stats. Nobody else can, and nobody can make
themselves the boss from inside the app — I blocked that on purpose.

---

## Is this actually secure?

Mostly yes, and much better than what you have now.

**What's real:**

- Passwords are scrambled on Supabase's servers, not on the phone. You can't
  see them and neither can I.
- Each person can only read their own rows. That's enforced by the database
  itself, so a clever person can't get around it by messing with the app.
- Only you can see everyone's stats, and only because you ran step 7 by hand.

**What's still true:** you are one person running a free project. Don't store
anything in here you'd be upset to lose or have leak. For a study app with test
scores, that's fine.

---

## Later, if you want the AI photo reading

Two more files are ready when you want them: `schema-ai.sql` and the
`functions/read-worksheet` folder. That's when you'd add a payment method to
Anthropic. Ask me and I'll walk you through it the same way.
