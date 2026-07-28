# SKTI branding assets

## Why there is no SKTI logo in this folder

SKTI is the **Kidney and Transplant Institute of the Southern Philippines Medical
Center**, a DOH government hospital in Davao City. Two things blocked an automatic
grab:

1. **No reachable source.** `spmc.gov.ph` no longer resolves; `spmc.doh.gov.ph`
   returns HTTP 403 to automated fetches. There is no public brand kit.
2. **Endorsement.** A government hospital seal on an app implies the hospital
   endorses it. That is SKTI's call to make, not the app's.

So the app ships with an **original** teal droplet mark (`icon.svg`) and shows a
generic kidney glyph in the header. Nothing here imitates an official seal.

## Adding the real logo

Once SKTI gives you the file and permission to use it:

```
assets/logo.png          ← drop it here (square, ≥192×192, transparent PNG)
```

The header picks it up with no code change — `index.html` renders the logo `<img>`
and falls back to the generic glyph only when the file is missing.

For the installed-app icon, also replace:

```
assets/icon.svg          ← home screen / browser tab
assets/icon-maskable.svg ← Android adaptive icon (keep art inside the middle 80%)
```

Then bump `CACHE` in `sw.js` (e.g. `skti-tubig-v2`), otherwise phones that already
installed the app keep serving the old icons from cache.

## Photos of the SKTI building

Photos of the SKTI facility exist only in news coverage of the November 2025
opening — Philippine Information Agency, Philippine News Agency, BusinessMirror.
Those are press photographs, not yours to redistribute inside an app, and the
sites block automated download anyway.

Two clean routes:

- **Ask SKTI** for facility photos plus written permission. This is the same
  conversation as the logo, so bundle it.
- **Shoot your own.** A photo of the SKTI entrance or dialysis floor taken with
  permission is yours to use and looks more current than a 2025 press photo.

Drop whatever you get here and reference it from the setup screen:

```
assets/skti-building.jpg
assets/skti-dialysis-floor.jpg
```

Keep them under ~150 KB each and convert to WebP — this app is used on cheap
Android phones on mobile data, and every asset is cached for offline use.
