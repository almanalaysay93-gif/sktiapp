# SKTI branding assets

## Files this app expects

| File | What it is | Status |
|---|---|---|
| `spmc-logo.png` | SPMC (Southern Philippines Medical Center) seal | **you add** |
| `skti-logo.png` | SKTI (Kidney and Transplant Institute) seal | **you add** |
| `skti-building.jpg` | Photo of the SKTI facility | present |
| `logo.png` | Legacy low-res SPMC seal | present, superseded by `spmc-logo.png` |
| `icon.svg` / `icon-maskable.svg` | Original app mark, not an official seal | present |

Save the two seals as **square, transparent PNG, ≥256×256**, named exactly as
above. Every place that renders them already has an `onerror` fallback, so the
app looks correct before you add them and upgrades itself once you do — no code
change needed. After dropping them in, bump `CACHE` in `sw.js` or already-installed
phones keep serving the old assets from cache.

## Endorsement — read before shipping

SKTI is a DOH government hospital. **A government seal on an app implies the
hospital endorses it.** That is SKTI's call to make, not the app's. Before this
build goes to real patients, get written permission to use both seals and the
facility photo. Until then the seals are safe to develop against locally, but do
not distribute.

The app's own mark (`icon.svg`) is deliberately **original** and imitates no
official seal, so the installed-app icon carries no endorsement claim.

## Installed-app icon

`icon.svg` (home screen / browser tab) and `icon-maskable.svg` (Android adaptive
icon — keep art inside the middle 80%) are the app's own mark. Replacing them
with an official seal would put the endorsement claim back on the installed icon,
so prefer keeping them original.

## Weight budget

Keep every image under ~150 KB and prefer WebP. This app runs on cheap Android
phones over mobile data, and the service worker caches every asset for offline
use — each kilobyte is paid on first load by patients on limited data.
