# Realtime Database rules (Dashboard, GIS Map, Analytics)

> Only relevant if you later move the Mobile Devices portal into `spugis`. While it stays on its own
> project (the current setup), you can ignore this file.

If the portal is moved into `spugis`, its two shared PIN logins (`admin@device-portal.local`,
`receiver@device-portal.local`) and its anonymous phone sessions would share the same user list as
the hub. Any Realtime Database rule that only says `auth != null` should then also exclude them:

    "auth != null
      && auth.token.firebase.sign_in_provider != 'anonymous'
      && auth.token.email != 'admin@device-portal.local'
      && auth.token.email != 'receiver@device-portal.local'"
