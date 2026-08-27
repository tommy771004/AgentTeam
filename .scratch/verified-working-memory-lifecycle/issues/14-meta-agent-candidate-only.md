# 14 — Meta-Agent 只產生 candidate

**What to build:** 讓 Meta-Agent 從結構化 Memory control trace 診斷失敗屬於 Skill、Working State、invocation policy 或 Checker，並只產生 schema-valid candidate patch；它不能直接啟用 package 或修改任意 application state。

**Blocked by:** 12 — Memory-Control evaluation promotion gate; 13 — Builtin、External CLI 與 plain-browser capability honesty

**Status:** resolved

- [x] Diagnostic input 來自 Turn Record 的 Working State、Skill invocation、tool evidence、State Check 與 package identity，不以自由文字 summary 取代結構化 trace。
- [x] 每次 diagnosis 只能選擇一個 component，或明確回報證據不足而不產生 candidate。
- [x] Meta-Agent output 僅接受符合 package schema 的 bounded JSON Patch；arbitrary TypeScript、filesystem path、settings、active revision 或 durable-memory row mutation 一律拒絕。
- [x] 未被診斷 components 的 digests 在 candidate 建立前後完全一致。
- [x] Candidate 預設保持 inactive，必須走既有 evaluation promotion gate；Meta-Agent 無 activation authority。
- [x] Diagnosis、candidate identity、rejection與 gate outcome 留下 bounded、可稽核 lineage。
- [x] Controlled traces 分別覆蓋四類正確 localization、ambiguous refusal 與越權 patch refusal，且 smoke 已加入實際 gate。
