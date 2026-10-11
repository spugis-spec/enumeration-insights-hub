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
