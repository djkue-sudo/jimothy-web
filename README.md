# Jimothy on the web

A plain HTML/JS page so crew members without an iPhone (Android and so on) can play. They sign in with a free Apple ID, pick a name and emoji, join with the crew code, type in their daily steps, and see the Board (Handicap by default, Raw one tap away).

They are full players. Their own iCloud account creates their `Player`, `Membership` and `DaySteps` records, so only they can edit them. `Player.selfReported = 1` marks them, and the app shows the same "Self-reported" marker it uses for guests. Handicap uses the crew's median baseline until they've entered 14 days, the same as guests.

Nothing in this folder is secret. A CloudKit API token only works from the origins you allow for it, and only does what a signed-in visitor could do anyway.

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/jimothy.css` | The page, mobile first, using the app's design tokens (Theme.swift). |
| `js/domain.js` | The app's rules ported from `Jimothy/Domain`: calendar, streaks, baselines, the crew-median rule, board ranking. Keep it in step with the Swift. |
| `js/cloud.js` | CloudKit JS: the same record types, record names and fields as `CloudCrewStore.swift`. |
| `js/config.js` | Container, environment and API tokens. |
| `js/mock-cloud.js` | An in-memory crew for checking the page on localhost (`?mock=live` or `?mock=warmup`). It is never loaded anywhere else. |
| `test/domain.test.mjs` | Tests that pin `domain.js` to the app's behaviour: `node --test web/test`. |

## 1. CloudKit schema

The page writes one field the Production schema doesn't have yet:

| Record type | Field | Type | Index |
|---|---|---|---|
| `Player` | `selfReported` | `INT64` | none (it's never queried) |

- **Development:** already imported (`cloudkit/schema.ckdb`). The before/after export differs only by this field.
- **Production:** deploy it in CloudKit Console → Schema → Deploy Schema Changes. Check the diff shows only `Player.selfReported`.

**Until that deploy is confirmed, keep `environment: "development"` in `js/config.js`.** On Production, every save from the page would be rejected until the field exists there.

## 2. CloudKit API token (one per environment)

In CloudKit Console, open the container `iCloud.com.michaelmorales.Jimothy`, then **Tokens & Keys → API Tokens**. Pick the environment (Development first), then add a token:

- **Name:** `jimothy-web`
- **Sign in callback:** *Post Message* (CloudKit JS signs in through a pop-up)
- **Allowed origins:** *Specific domains*, then add:
  - `https://<your-github-username>.github.io`. This is the origin only, with no `/jimothy-web` path.
  - `http://localhost:8765`, for local testing. Development token only.
- **User discoverability:** leave it off.

Copy the token into `apiTokens.development` in `js/config.js`.

Later, after the Production deploy, repeat with the environment set to Production. List only the GitHub Pages origin, no localhost. That token goes into `apiTokens.production`.

## 3. Test against Development (second Apple ID)

1. Serve the folder locally: `cd web && python3 -m http.server 8765` (or any static server). Open `http://localhost:8765` in a browser where you're signed in to **nothing** at icloud.com.
2. Sign in with your second Apple ID. Pick a name and emoji, then join your **Development** test crew's code. The real crew's code won't work: Development and Production are separate databases.
3. Enter today's steps and a past day, then check the result on the iPhone running a Development build:
   - The runner is on the Board with "Self-reported".
   - Their handicap uses the crew median.
   - They show up in heats.
4. Change the steps for a day and check it replaces the day rather than adding to it.

## 4. Host it on GitHub Pages (separate public repo `jimothy-web`)

1. Create an empty **public** repository named `jimothy-web` on GitHub, with no README.
2. From this repo, push only the `web/` folder as that repo's `main` branch:
   ```sh
   git subtree split --prefix web -b jimothy-web-pages
   git push https://github.com/<your-github-username>/jimothy-web.git jimothy-web-pages:main
   git branch -D jimothy-web-pages
   ```
   Run these same three commands again whenever `web/` changes.
3. In `jimothy-web` on GitHub, go to **Settings → Pages → Build and deployment**. Choose *Deploy from a branch*, then `main` and `/ (root)`.
4. The page is at `https://<your-github-username>.github.io/jimothy-web/`. That origin must be in the API token's allowed origins (section 2).
5. While `environment` is `"development"`, the page shows "Test mode (development)". Flip it to `"production"` only after the schema deploy, with the Production token pasted in.

To test Production before sharing the link, you can force either environment with `?env=development` or `?env=production` on the URL.

## 5. What the iPhone app does with web runners

These changes are on `main` and ship in the next build. They only **read** the new field, so they're safe with or without the Production deploy:

- **Read the field:** `Player.selfReported` is read from the record. The app never writes it.
- **Marker:** `Player.isSelfReported` (a guest or a web runner) drives the "Self-reported" marker on Board rows, the podium, VoiceOver labels and the Profile member list.
- **Median:** the crew-median baseline leaves out every self-reported runner, not just guests.
- **Guests list unchanged:** the creator's guest management still lists only `p_guest_` guests. Web runners own their records, so the creator can't edit them.

Two known limits, both the same as for guests:
- Web runners don't earn badges, because badges are evaluated on each runner's own iPhone. They never show "moved recently".
- If a web runner later installs the app with the same Apple ID, the marker stays until a later build clears `selfReported` on the app's own sync. That write has to wait for the Production deploy.
