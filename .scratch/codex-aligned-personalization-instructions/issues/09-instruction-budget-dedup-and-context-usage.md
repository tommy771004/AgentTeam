# 09 — Instruction budget、去重與 context usage

**What to build:** 讓大型全域規則、專案指令與 include 在有限 context 中有可理解的預算：高 authority instruction 先保留、重複內容不浪費 token、所有裁切與 omitted source 都可在 Personalization、run diagnostics 與 context usage 中看到。

**Blocked by:** 08 — Revision events 與 run snapshot isolation.

**Status:** resolved

- [x] Global personalization 與 project instructions 有獨立、可稽核的 ContextPacket slot／sub-budget，不再混成不透明 extra context。
- [x] Global、project、include 與其他 model-visible context 共同遵守一個 total budget，且高 authority instruction 在 learned memory 前保留。
- [x] Exact duplicate content 以 normalized content hash 去重，provenance 仍保留所有來源；近似文字不做可能改變語意的自動合併。
- [x] 每個 source 記錄 requested、included、deduplicated、truncated 或 dropped bytes 及原因。
- [x] Personalization 在 save／discovery 時顯示 context pressure，不等到模型輸入後才默默裁切。
- [x] Run context usage 分別呈現 personalization、project instructions 與其他 context 類別，live/replay 數值一致。
- [x] Turn Record 的 effective text 與 diagnostics 能重建實際送出內容，而不是只記錄裁切前來源。
- [x] Shipped-module smoke 覆蓋總預算、per-source cap、重複內容、authority retention、Unicode clipping 與 live/replay parity。
