# SubAgents AI — App Icons

## Mark concept

**Connected working set + independent candidate** — three linked nodes show shared execution context; the amber node remains deliberately independent until admitted. The geometry is a high-resolution reconstruction of the supplied app-icon reference.

## Style

Flat royal blue (`#0075DE`) squircle, white orthogonal links, white/ice-blue connected nodes, and one amber (`#FEB10F`) independent node. No gradient, shadow, blur, or texture.

## Files

| File | Use |
|------|-----|
| `icon.svg` | Master (light / brand) |
| `icon-dark.svg` | Dark chrome variant |
| `icon-{16…1024}.png` | Raster pack |
| `icon-1024.png` | macOS electron-builder source |
| `icon.png` | 512px runtime compatibility copy |
| `icon-dark-{32…512}.png` | Dark pack |

Also copied to `public/favicon.svg`, `public/favicon-32.png`, `public/brand/`.

## Regenerate

```bash
npm run icons
```

## Why icons might not show

1. **`public/` is not the Electron source of truth.** Master is `build/icons/icon.svg`. `npm run icons` writes PNGs to `build/icons/` and *copies* them to `public/favicon*` + `public/brand/`. Editing only `public/` does not update `.exe` / window icons until you change the master and re-run `icons` (or place matching files under `build/icons`).
2. **Windows `.exe` needs `.ico`** — `build/icon.ico` (multi-size). PNG alone is not enough for the installer/exe shell icon.
3. **Runtime window/tray** (`main.ts` `loadAppIcon`): packaged `resources/app-icons/` → dev `build/icons/` → fallback `public/brand` / `dist/brand`.
4. After changing icons: `npm run icons && npm run dist:win`, then reinstall or run `release/win-unpacked/SubAgents AI.exe`. Clear Windows icon cache if the taskbar still shows the old Electron icon.
