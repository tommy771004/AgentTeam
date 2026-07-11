# SubAgents AI — App Icons

## Mark concept

**Multi-agent orbital loop** — three role nodes (Manager / Analyzer / Writer) on a continuous cycle around a shared core. Unique to this product (loop engine + sub-agents), not a Claude/Gemini/OpenAI clone.

## Style

Same presentation language as model chips (squircle tile + flat geometric mark), with project cyan (`#14b8d4` → `#0e7490`) and core navy (`#0b1326`).

## Files

| File | Use |
|------|-----|
| `icon.svg` | Master (light / brand) |
| `icon-dark.svg` | Dark chrome variant |
| `icon-{16…1024}.png` | Raster pack |
| `icon.png` | electron-builder default (512) |
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
