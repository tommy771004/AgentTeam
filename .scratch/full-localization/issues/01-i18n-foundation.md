# 01 — 抽取層、語言設定與對帳閘門

**What to build:** 使用者在設定的外觀節看到「介面語言」，可選跟隨系統／繁體中文／English，切換即時生效不重啟。這一票同時鋪好整個系列的地基：一個輕量 `t(key)` 抽取層、zh-TW 語言檔（source of truth）、缺翻自動 fallback zh-TW、以及一支 fail-closed 對帳檢查——使用點與語言檔雙向缺漏都讓 build 紅。以一個域（外觀設定節）走完整條路作為證明。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `t(key)` 抽取層可用，key 具型別安全，支援 `{param}` 內插
- [x] zh-TW 語言檔建立，現行字串原樣遷入（視覺零 diff）
- [x] 「介面語言」進 settings registry（tier basic、外觀節），遵循新增欄位的四處編輯慣例
- [x] 跟隨系統可用；切換即時重繪不重啟
- [x] 缺 key 自動 fallback zh-TW，不炸畫面
- [x] fail-closed 對帳 smoke：使用點 ↔ zh-TW 檔雙向缺漏都失敗
- [x] 外觀節完整走 `t()`，`npm run build`／smoke／元件測試全綠

## Answer

`src/i18n/` 三個檔就是全部的框架：`index.ts`（查表 + 內插 + fallback + 系統語言解析）、`locales/zh-TW.ts`（source of truth，`MessageKey` 型別由它的 key 推導）、`useTranslation.ts`（React 綁定）。刻意不引重型 i18n 框架——複數規則與 ICU 格式目前用不到，先不背。

**即時切換不需要 provider 或事件**：語言來自 settings store，`useTranslation` 訂閱它，切換語言自然讓所有用到 `t` 的元件重繪。「跟隨系統」再訂閱 `languagechange`，OS 改語言時也會跟著變。

**四處編輯慣例**（系列 3/6 更新過的規則）全部走完：`types.ts` 的 `uiLanguage`、`DEFAULT_LLM_SETTINGS` 的 `'system'`、registry 的 `appearance.language` 宣告、`AppearancePanel` 的控件。registry 的 fail-closed 檢查當場抓到我漏了第四處（宣告了欄位卻沒有渲染錨點），正是它該做的事。

**registry 文案也能 key 化**：`SettingsFieldDef` 新增選用的 `labelKey`／`summaryKey`，`SettingsGroupFor` 新增 `titleKey`。已宣告 key 的欄位走語言檔，未宣告的沿用原本的 zh-TW 字面值——各域可以分批遷入而不必一次到位。

**對帳閘門雙向 fail-closed**（`scripts/smoke-i18n.mts`，11 項）：使用點沒有對應 key 會失敗（畫面會顯示 raw key），語言檔有孤兒 key 也會失敗（沒人用的字串是下一個翻譯者的白工）。掃描同時涵蓋 `t('…')`、registry 的 `labelKey:` 物件屬性與元件的 `titleKey="…"` JSX 屬性——第一版漏了 JSX 形式，孤兒檢查立刻把它抓出來。另驗內插參數在 zh/en 之間一致（少一個參數就會漏字）、en 不得多出 zh-TW 沒有的 key、缺翻 fallback 行為。

外觀節（含新的介面語言欄位）完整走 `t()`，zh-TW 文字與遷入前逐字相同；en 對這 35 個 key 已 100% 覆蓋。

驗證：`npm run build` BUILD_EXIT=0、`npm run smoke` SMOKE_EXIT=0、`npm test` 121 passed（新增 7）、`smoke-i18n` 11 項、`smoke-settings-registry` 22 項、`oxlint` 0 errors。
