<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- The original report dashboard runs unchanged from `public/legacy/index.html` inside an iframe on `/`; port logic out of it only deliberately, because its workflows must stay identical.
- Firebase (project `spugis`) is the backend, accessed through `src/lib/firebase.ts`; the React `AuthProvider` and the legacy page share the same origin so one Firebase sign-in persists across both.
- Spreadsheet parsing for new pages runs in `src/lib/parse.worker.ts` so large files never block the UI.
- One Firebase project (`spugis`) and one sign-in for everything. `src/lib/firebase.ts` owns the app (Auth, Realtime Database, Firestore via `getFs()`); the header sign-in covers every tab.
- The DT Field Manager (`/field`, `/projections`, `src/components/field`, `src/lib/field`) now runs on that same project: Firestore collections are unchanged, access is the role record `users/{uid}`; `FieldRoleGate` lets the first signed-in person claim admin. It no longer has its own Firebase app or login.
- Weekly Report (`/weekly-report`, `src/components/weekly`, `src/lib/weekly`) is the original Feeder Dashboard. Its Firestore collections are prefixed `weekly_` so they never clash with the Field Manager's `users`. Keep its markup/classes identical to the original; `.weekly-root` in `styles.css` restores its font, border colour and radii.
- Mobile Devices (`/devices`) iframes the original standalone portal at `public/device-portal/index.html` (also served directly for staff phones). It deliberately stays on its OWN Firebase project (`device-collection-database`), with a named Firebase app (`device-portal`) so its anonymous/PIN sessions never replace the hub sign-in.
- Firestore rules live in `firebase/firestore.rules`; one-off data copy tool is in `migration/`. See `MERGE_GUIDE.md`.
- Values shared between the legacy dashboard iframe and React pages (daily target, projection buffer, current dashboard date) live in same-origin localStorage via `src/lib/shared.ts`; the daily target is also mirrored to RTDB `settings/dailyTarget`.
- The legacy dashboard spools compact GIS points per dashboard date into IndexedDB (`eih-gis`) and, on cloud save, RTDB `gisPoints/{date}` + `gisPointsIndex`; the map reads them via `src/lib/gisSpool.ts` so raw files need not be re-uploaded.
- Enumerator WhatsApp numbers are stored separately at RTDB `enumeratorPhones/{username}` so the existing `mappings` structure stays unchanged.
