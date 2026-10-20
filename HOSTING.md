# Hosting: the website and the game

Boarding Pass is two sites built from this one repository:

| Address | What it is | Built from | Hostinger settings |
|---|---|---|---|
| **boardingpass.my** | The website: home page, downloads, what's new, community, credits, privacy | the `website` folder | Root directory `website`, build command `npm run build`, output directory `dist` |
| **play.boardingpass.my** | The game, in the browser | the `play-build` branch (built by GitHub) | A Hostinger website with **Git** deployment of branch `play-build`; no build step |

boardingpass.my is a Hostinger **Node.js web app** on branch `main`. play.boardingpass.my is a plain Hostinger website that copies the branch `play-build`: on every push to `main`, the **Play build** workflow (`.github/workflows/play-build.yml`) builds the game on GitHub and replaces `play-build` with the finished files, so Hostinger has nothing to build. (A plain website can't run `npm run build`; copying `main` itself gives a blank page with "'text/plain' is not a valid JavaScript MIME type".) The website links to the game at `https://play.boardingpass.my`, and the game's home screen links back to `https://boardingpass.my`.

## Set it up (once)

Do the game first, so it is never offline.

### 1. Put the game on play.boardingpass.my

1. Open the **play.boardingpass.my** website in hPanel and go to its **Deployments** (or **Advanced → Git**) settings, connected to GitHub's **Boarding-Pass** repository.
2. Change the **branch** from `main` to **`play-build`**. Leave the install folder as Hostinger set it.
3. Click **Deploy** (or Redeploy). The log copies the files in a few seconds; there's no npm step, and that's correct.
4. Open `https://play.boardingpass.my`: you should see the game's home screen. If you still see a blank page, clear the cache in hPanel (**Cache → Clear cache**) and reload.
5. If Hostinger has an **Auto deployment** switch or webhook for this site, turn it on, so each new `play-build` goes live by itself. Otherwise, press Deploy after each update.

If the play-build branch is missing on GitHub, open the repository's **Actions** tab, pick **Play build** and click **Run workflow**.

### 2. Turn boardingpass.my into the website

1. Open the existing **boardingpass.my** website in hPanel, then its deploy or build settings (on the Dashboard, the ⋮ menu next to **Redeploy**, or **Deployments → settings**).
2. Change **Root directory** to `website`. Keep the build command `npm run build` and the output directory `dist`.
3. Save and click **Redeploy**. Open `https://boardingpass.my`: you should see the home page with the boarding pass and the **Play in your browser** button.

If Hostinger doesn't let you change the root directory of an existing app: in hPanel remove the boardingpass.my website (Websites → boardingpass.my → ⋮ → Delete website; your domain stays registered), then add it again as in step 1 with the domain **boardingpass.my** and the root directory `website`.

### 3. Check

- `https://boardingpass.my` shows the website; **Play now** opens the game.
- `https://play.boardingpass.my` shows the game; **boardingpass.my** on its home screen goes back.
- Both show a padlock (SSL). A new subdomain can take a few minutes to get its certificate.

## Every update after that

Nothing to do: pushing to `main` rebuilds the website, the Play build workflow refreshes `play-build` for the game about a minute later, and the website reads the latest version and the What's new list from GitHub by itself. To change the website's text, edit the files in `website/` (the home page is `website/index.html`).

## Notes

- **One push, two builds.** Both apps rebuild on every push, even when only one of them changed. That's normal and quick.
- **Saves are per address.** Careers played at `play.boardingpass.my` are stored in that browser for that address. Careers from the earlier test at `boardingpass.my` stay with that address: open the game there before switching and use **Menu → Export save file**, then **Import save file** on play.boardingpass.my.
- **Free and non-commercial.** The satellite imagery and the free map tiles are licensed for non-commercial use, so neither site may carry ads or paid features, and the map credits must stay visible.
