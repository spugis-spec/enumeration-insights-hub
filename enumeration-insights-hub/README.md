# Enumeration Insights Hub

Build an updated Vite and React application based on the attached AEDC GIS Enumeration Performance Report Dashboard (index (34).html) while keeping all process flows, logic, and data structures identical.

Key Requirements:
1. Retain all existing workflows and data processing from the attached HTML file:
   - File upload slots: DSS, HT, LT, Customer Enumeration, Issues Log, and Feeder Lookup (supporting .xlsx, .xls, .csv via SheetJS).
   - Enumerator rosters and mappings for AEDC, BSS, NYSC, provisional enumerators, and buddy pairings.
   - Report generation by single date or date range, asset counts, FID tracking, NYSC CDS automatic excuses, zero-entry remarks, and call-back form duplicate registry.
   - Monthly performance tracking, bulk work-day assignment, and Excel export with styled formatting.
2. Firebase Auth & Realtime Database:
   - Use the existing Firebase configuration from the file (authDomain: spugis.firebaseapp.com, databaseURL: https://spugis-default-rtdb.firebaseio.com).
   - Fix session persistence with an AuthProvider listening to onAuthStateChanged so page refreshes retain the logged-in admin state and do not bounce back to the login modal.
   - Connect directly to the existing Firebase Realtime Database paths (dashboards, mappings, feederLookup, feederOverrides, feederCompletionStatus, staffHistory, pairings, monthlyPerformance, callbackFormRegistry).
3. Interactive GIS Map Interface:
   - Add an interactive GIS map view (using Leaflet / MapLibre) that plots enumeration locations, feeder boundaries, and asset distribution (DSS, HT, LT, Customer meters).
   - Allow filtering points by feeder, enumerator, and date range with inspection popups.
4. Advanced Statistics & Fast UI:
   - Render interactive performance charts (team comparison, daily velocity, feeder target completion, and zero-entry monitoring).
   - Smooth asynchronous parsing and responsive layout that never freezes the browser.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fe282683-9818-4a62-8c39-ec61c43c0f4f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
