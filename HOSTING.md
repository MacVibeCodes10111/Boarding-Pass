# Hosting: the website and the game

Boarding Pass is two sites built from this one repository:

| Address | What it is | Built from | Hostinger settings |
|---|---|---|---|
| **boardingpass.my** | The website: home page, downloads, what's new, community, credits, privacy | the `website` folder | Root directory `website`, build command `npm run build`, output directory `dist` |
| **play.boardingpass.my** | The game, in the browser | the top of the repository | Root directory empty (or `/`), build command `npm run build`, output directory `dist` |

Both are Hostinger **Node.js web apps** connected to the GitHub repository `MacVibeCodes10111/Boarding-Pass`, branch `main`. Every push to `main` rebuilds both. The website links to the game at `https://play.boardingpass.my`, and the game's home screen links back to `https://boardingpass.my`.

## Set it up (once)

Do the game first, so it is never offline.

### 1. Put the game on play.boardingpass.my

1. In hPanel, open **Websites → Add website → Node.js web app**.
2. Choose **Import Git repository**. GitHub is already connected; pick **Boarding-Pass**.
3. When it asks for the domain, choose a **subdomain** of boardingpass.my and type `play`. If it only lists whole domains, first create the subdomain under **Domains → boardingpass.my → Subdomains** (name `play`), then start again from step 1.
4. Check the build settings Hostinger fills in:
   - Framework: **Vite**
   - Branch: **main**
   - Root directory: **empty** (or `/`). Hostinger may suggest `website`, because the repository has two projects: change it back to empty for the game.
   - Build command: `npm run build`, output directory: `dist`, Node.js **22**
5. Click **Deploy**. When it says Completed, open `https://play.boardingpass.my`: you should see the game's home screen.

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

Nothing to do: pushing to `main` rebuilds both sites, and the website reads the latest version and the What's new list from GitHub by itself. To change the website's text, edit the files in `website/` (the home page is `website/index.html`).

## Notes

- **One push, two builds.** Both apps rebuild on every push, even when only one of them changed. That's normal and quick.
- **Saves are per address.** Careers played at `play.boardingpass.my` are stored in that browser for that address. Careers from the earlier test at `boardingpass.my` stay with that address: open the game there before switching and use **Menu → Export save file**, then **Import save file** on play.boardingpass.my.
- **Free and non-commercial.** The satellite imagery and the free map tiles are licensed for non-commercial use, so neither site may carry ads or paid features, and the map credits must stay visible.
