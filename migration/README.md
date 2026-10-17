# Copy the old projects into `spugis`

One-off tool. It reads from the old Firebase projects and writes to `spugis`. It never changes or deletes anything in the old projects.

## What you need

For **each** project you want to copy (including `spugis` itself):

1. Firebase console > Project settings > Service accounts > **Generate new private key**.
2. Save the file in `migration/keys/` (this folder is git-ignored). Never commit these files, and delete them when you are done.

| Project | Key file (suggested name) | Needed for |
| --- | --- | --- |
| `spugis` (destination) | `keys/spugis.json` | always |
| `dt-field-manager` | `keys/dt-field-manager.json` | Field Manager data + logins |
| `device-collection-database` | `keys/device-collection-database.json` | Mobile Devices data |
| the project the Feeder Dashboard used | `keys/feeder-dashboard-project.json` | Weekly Report data |

Leave a section out of `config.json` to skip it. If the Feeder Dashboard already used `spugis`, leave `weekly` out and rename its collections by hand to `weekly_feederLookup`, `weekly_currentReport`, `weekly_previousReport`, `weekly_savedWeeks`.

## Keeping Field Manager passwords

Firebase can move a password hash, but only if you pass the source project's hash settings.

1. In the `dt-field-manager` console: Authentication > Users > the three-dot menu > **Password hash parameters**.
2. Copy `base64_signer_key` and `base64_salt_separator` into the `hash` block of `config.json`. Rounds `8` and memory cost `14` are the standard values shown there.

Without the `hash` block the logins are still imported, but with no password; each person then uses a password reset.

## Run it

```bash
npm install
cp config.example.json config.json    # edit paths / hash settings
npm run dry-run                       # counts only
npm run migrate                       # real copy
```

Add `--overwrite` (`node migrate.mjs --overwrite`) to replace documents that already exist in `spugis`. Without it they are skipped, so the script is safe to run twice.

## Notes

- People are matched between projects **by email**. If someone already has a `spugis` account, their Field Manager role record is attached to that account instead of creating a second login.
- Uid references inside the data (`allocations.allocated_by`, `dts.updated_by`, `meta/setup.adminUid`) are updated to match.
- Sub-collections are not copied. None of the three apps use them.
- Anonymous sessions (device-portal staff phones) are not logins and are not copied.
- Device-portal PIN accounts: set `"importPinAccounts": true` plus a `hash` block under `devices` to carry them over. Otherwise create `admin@device-portal.local` and `receiver@device-portal.local` in the `spugis` console with the PINs you want. The admin PIN must be at least 6 characters.
