# 01 — 測試基礎設施（vitest + Testing Library seam）

**What to build:** 開發者可以一鍵執行元件測試：引入 vitest + jsdom + @testing-library/react，完成設定與 npm script，並以至少一個既有元件的真測試（render + 斷言可見文字/行為）打通 seam。既有的 build 與 smoke 閘門不受影響，測試依賴只進 devDependencies、不進打包 runtime。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] vitest + jsdom + @testing-library/react 安裝並設定完成，npm script 一鍵執行全部元件測試
- [x] 至少一個既有元件的真測試通過，證明 React 19 render 與斷言環境可用
- [x] `npm run build` 與 `npm run smoke` 全綠不受影響
- [x] 測試依賴僅為 devDependencies，electron-builder 打包不帶入 runtime

## Answer

vitest 4.1.10 + jsdom 30.0.1 + @testing-library/react 16.3.2（另加 jest-dom 7.0.1、user-event 14.6.4）以 devDependencies 安裝；`vitest.config.ts`（獨立於 electron 插件的 vite config）、`src/test/setup.ts`（jest-dom/vitest + matchMedia stub）、npm scripts `test`／`test:watch`。首個真元件測試 `ConfidenceRing.test.tsx` 3 案通過。依賴審查（dependency-reviewer agent 不可用，改以 npm audit + 授權檔替代）：5 套件全 MIT、零 advisories（11 個既有警示皆屬舊依賴）、版本相容（vitest 4 ↔ vite 8、TL 16 ↔ React 19）。驗證：`npm test` 3 passed；`npm run build` 綠（僅既有 warnings）；`npm run smoke` 全鏈 exit 0。
