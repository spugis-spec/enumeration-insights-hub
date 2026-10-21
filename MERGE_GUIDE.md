# Merge guide: one app, one login, one Firebase project

This app now contains everything in one place:

| Tab | What it is | Source |
| --- | --- | --- |
| Dashboard, GIS Map, Analytics | unchanged | this repo |
| Field Manager, Projections | unchanged screens and logic | this repo (DT Field Manager) |
| Weekly Report | the Feeder Dashboard components, same tables, Excel export, saved weeks, comparison | `feeder-dashboard` |
| Mobile Devices | the original device portal, loaded unchanged in the tab | `device-portal` |

Everything except the Mobile Devices portal runs on the `spugis` Firebase project, and you sign in once at the top right for all of those tabs. The portal keeps using its own original Firebase project (`device-collection-database`), so its saved data, settings and PIN logins stay exactly where they are.

## 1. One-time setup in the `spugis` Firebase console

1. **Firestore.** Build > Firestore Database > Create database (if it does not exist yet). Pick a region near you.
2. **Rules.** `firebase/firestore.rules` is your live `spugis` rules plus the `usernames` block (sign in with a username), the `alert_resolutions` block (Capture Alerts answers) and the four `weekly_*` blocks the Weekly Report needs. If your live rules already match it, nothing to do; otherwise paste it into Firestore > Rules and publish.
3. **Authorized domains.** Authentication > Settings > Authorized domains: add the domain you host this app on in **both** `spugis` and `device-collection-database` (the portal signs in there).
4. **Realtime Database rules.** Nothing to change for this merge. (`firebase/database.rules.notes.md` only matters if you later move the portal into `spugis`.)

## 2. Move the existing data and logins

Your Realtime Database (`spugis`) already holds the Dashboard data, so that part needs nothing. Field Manager and the Weekly Report had their own projects; `migration/` copies them across. The Mobile Devices portal needs no migration. Full steps are in `migration/README.md`. In short:

```bash
cd migration
npm install
cp config.example.json config.json     # fill in key paths (see README)
npm run dry-run                        # shows counts, writes nothing
npm run migrate
```

What it does:

- **Field Manager**: copies every collection with the same document IDs, and moves the Firebase logins. People whose email already exists in `spugis` are matched to that account, and their role record is re-keyed to the new uid. Passwords carry over if you give it the project's password-hash settings; otherwise they must reset their password.
- **Weekly Report**: copies `feederLookup`, `currentReport`, `previousReport`, `savedWeeks` to `weekly_*`. The Feeder Dashboard's own username/password list is not copied; those people sign in with a normal account instead.

It never deletes anything from the old projects, and by default it skips documents that already exist in `spugis`.

## 3. First sign-in

- If you migrated the Field Manager, its admins and supervisors keep their roles.
- If you did not, the first person to open Field Manager gets a **Make me the admin** button. After that, add people in Field Manager > Users & Staff. Those accounts also work for every other tab.
- Weekly Report works for any signed-in account that is not one of the device-portal PIN accounts.

## 4. Things that behave differently (on purpose)

- **Weekly Report login.** The old username/password screen is gone; the top-bar sign-in replaces it. Deleting a saved week still asks for a password, now the password of the account you are signed in with.
- **Field Manager sign-out** signs you out everywhere, because it is one session. `/field-sign-in` now just forwards to `/field`.
- **Mobile Devices keeps its own Firebase project and its ID-card and PIN screens.** Those are how field staff and the receiving officer use it on their phones, and you asked for no change in how it works. They run in a separate Firebase session, so they never log you out of the hub. The same file is also served at `/device-portal/index.html`, so staff can keep a phone shortcut without opening the hub. The only edit to it is using a named Firebase app so it can never replace the hub's sign-in (a few lines); its Firebase project is its original one. If you ever want it inside `spugis`, enable Anonymous sign-in there, run the migration's `devices` section, and change the config near the top of `public/device-portal/index.html`.

## 5. Hosting

The build is unchanged from before (`npm run build`, Cloudflare/Lovable target), so deploy it the way you deploy the hub today. GitHub Pages is not a drop-in target for this app because it is a server-rendered TanStack Start project, and the Dashboard and Devices tabs load files from the site root.

Firebase 13 needs **Node 24 or newer**. Install with `npm install` (the `.npmrc` handles a peer-dependency quirk) or `bun install`.

## 6. What has and has not been tested

Checked: type-check, production build, existing test, every route serves, the signed-out views, the Devices tab embedding the portal, and the migration helpers' unit tests.

Not checked, because it needs your live Firebase projects: signing in, the rules against real data, the migration against real data, and the Weekly Report with real files. Run `npm run dry-run` before the real migration, and keep the old projects until you have looked through each tab.

## Merge Feeders tool (Dashboard > Upload Data Files)

The standalone `MergeFeeders_FINAL2.html` now lives inside the Dashboard, hidden until you press **🧩 Merge Feeders tool** next to "Upload Data Files". It loads only when opened.

- Steps 1 to 4 are the original tool: zipped exports in, choose the date/time column, choose columns to keep, optional date range, optional output folder (Chrome/Edge), export as CSV or Excel. **Process only (no export)** skips saving files.
- **Step 5** is new: each processed file is matched to an upload box (DT / Substation, HT Pole, LT Pole, Customer Enumeration, Issue Log) by file name, then by columns. You can change a match or untick a file, then press **Attach**. It goes into the box the same way as uploading the exported CSV by hand. Only one file fits each box.
- **Generate the report for the date you want**: pick a date (or a from-through range) and press Generate Report.

The tool's own libraries (JSZip, PapaParse) are served from `public/legacy/merge-feeders/`, not a CDN. The rest of the Dashboard page still loads some libraries from CDNs, so for a fully offline machine keep using the standalone HTML file.

## Capture checks: Customer Enumeration + LT Pole (Field Manager > Data Uploads)

- **Two files.** Upload a Customer Enumeration file, an LT Pole file, or both. Both carry the DT ID (a `DT ID` column, or one starting with `dss_`). LT Pole captures show who worked on a DT but are not counted as customers, so progress numbers are unchanged.
- **Check the Dashboard's upload** reads the Customer Enumeration and LT Pole data the Dashboard last saved to the cloud (Save to Cloud there).
- **Which feeders and dates.** Before anything is saved you choose which of the lookup's feeders to check (locked feeders are pre-selected) and the dates. Data on other feeders is left out. The one exception: someone who works on the chosen feeders but captured on a feeder that is not in the lookup is flagged as picking the wrong feeder.
- **Flags** carry the FID, DT ID, feeder, building code, structure no., customer no. and call-back form no. They are listed in Capture Alerts and can be downloaded after each check.
- **Self-assigned DTs.** If a staff member captured on a DT nobody had assigned on the app, the DT is assigned to them (status Assigned) and marked **Self-assigned · needs authorization** in DT Allocation, where you or a supervisor can **Authorize** or **Reject** it. Captures on it stay flagged until it is authorized.
- **Partners.** A capture on a DT that is assigned to someone else is flagged, and marked as a team partner when the Dashboard pairing says so.
- **Who worked on a DT.** Every username that captured on a DT is kept against it, shown under the DT as "Captured by", even after the person left: supervisors in blue, people resolved as left struck through with the reason, people not on the staff list in red, self-assigned in amber. Clearing captures does not erase this.
- No Firebase rule changes are needed for this.
