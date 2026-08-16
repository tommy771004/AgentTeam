# 02 — zh-TW 原樣遷入：設定域

**What to build:** 這個域（設定頁的 18 個 panel、registry 的欄位標籤與說明文字）的所有介面字串改走 `t(key)`，語言檔以現行文字原樣入檔。使用者這一側完全無感——文案、順序、標點與現在逐字相同（視覺零 diff）；改變的是這些字串從此可以被翻譯。

**Blocked by:** 01

**Status:** resolved

- [x] 本域所有 UI 字串改走 `t(key)`，key 依頁面／元件分域命名
- [x] zh-TW 語言檔文字與遷入前逐字相同
- [x] 帶變數的字串以 `{param}` 內插表達，不用字串相接
- [x] 對帳 smoke 全綠（無孤兒 key、無未宣告使用點）
- [x] `npm run build`、smoke、元件測試全綠

## Answer

設定域 17 個 panel 全數遷入，zh-TW 從 35 → 328 keys，使用點 328（雙向對帳零差）。**en 同批翻譯完成，328/328 覆蓋率 100%。**

**做法是寫工具而不是手改**：`scripts/i18n-extract.mts` 把 CJK 字面值／JSX 文字／JSX 屬性改寫成 `t('key')`，自動補 import 與 hook，並把 key 追加進 zh-TW。key 用內容雜湊（`settings.mcp.a3f2`）而非流水號——重排與增刪不會 churn。

**工具在過程中被它自己的閘門抓到三次，每次都收斂成規則：**

1. **多行 import 被插爆**：只用 `/^import[^\n]*/` 找「最後一個 import」，會把新的 import 插進 `import {` 與 `} from` 中間。改為逐行追蹤多行 import 的結束。
2. **樣板字串跨界吞程式碼**：即使排除 `$`，相鄰的多個樣板仍會被跨界匹配，把一整段程式碼吃掉（LlmPanel 當場語法錯）。**整條規則移除**——樣板字串一律留給人。tsc 擋得住語法錯，但「靜靜改壞一段字串」比留著沒遷入糟得多。
3. **單引號寫的 JSX 屬性**：`placeholder='…'` 被當一般字串換成 `placeholder=t('key')`，少了大括號就不是合法 JSX。補上專門規則，且必須排在一般字串規則之前。

批次流程本身也有閘門：每個檔案跑完立刻 `tsc`，非零就還原該檔（SafetyPanel 第一輪就是這樣被擋下並修好的）。

**視覺零 diff 已抽樣驗證**：`settings.general` 全部 28 個 key 的文字都逐字出現在遷入前的原始碼裡。多行 JSX 文字節點帶進來的「換行＋縮排」統一收成單一空白——HTML 本來就會摺疊，畫面完全相同，但翻譯者看到的是乾淨句子。

**新增守則**：語言檔不得留下 `${...}` 殘骸（那種字串會把內插原樣印在畫面上）。

**既有契約檢查跟著調整**：兩支 drift guard 斷言的中文文案現在住在語言檔裡。共用的 `settingsSurface.mjs` 一併納入 zh-TW 檔——讓「這段文案還在不在」的檢查繼續有效，而不是被迫改寫成比對 key。

驗證：`npm run build` BUILD_EXIT=0、`npm run smoke` SMOKE_EXIT=0、`npm test` 121 passed、`smoke-i18n` 12 項、`oxlint` 0 errors。
