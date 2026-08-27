# 12 — Memory-Control evaluation promotion gate

**What to build:** 將現有 fixed-task evaluation 擴成 Memory-Control Package promotion gate。Candidate 必須修復來源失敗、保持 held-out anchors，且沒有 false-done 或不受控 token/invocation regression 才能啟用。

**Blocked by:** 09 — Skill preflight retry 與 parallel batch barrier; 11 — Component-local candidate、activation 與 rollback

**Status:** resolved

- [x] Evaluation tasks 經 canonical headless Task run coordinator 與真實 Host lifecycle 執行，不使用重寫的 fake evaluator。
- [x] Corpus 分離 source-failure tasks 與 held-out successful anchors，candidate 無法讀取或改寫 expected outcomes。
- [x] 每次 run 記錄 task success、false-done、required-action recall、Skill invocation precision/reach、prompt tokens 與 tokens per success。
- [x] 任一 false-done、required-action recall regression、missed required Skill、unjustified Skill invocation 或超出明確 budget 的 token regression 都阻止 promotion。
- [x] Candidate 通過 gate 後才呼叫原子 activation；失敗結果把 candidate 標記 rejected 且 active revision 不變。
- [x] Evaluation report 保存 governing package、task corpus version 與 bounded trace references，使結果可重跑與比較。
- [x] Gated smoke 同時證明一個改善 candidate 可 promotion，以及多種 regression candidate 必須被拒絕，並已加入實際 smoke gate。
