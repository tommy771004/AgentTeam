# 03 — Verified channel promotion

**What to build:** 建立唯一 protected publish owner，只在 verified `release-ready` receipt 成立後，將同一組 qualified artifacts 發布到明確的 Beta 或 Stable channel。

**Blocked by:** 01 — Packaged change evidence schema；02 — Package jobs 改為 candidate-only。

**Status:** 可交給代理

- [ ] Publish job 只依賴 verified promotion receipt，並是唯一取得 update publish credential 的 job。
- [ ] Channel 是 closed enum，實際參與 public download URL、upload destination 與 promotion evidence。
- [ ] Commit、workflow run/attempt、version、manifest 與 installer hashes 全部一致才可發布；mixed attempt fail closed。
- [ ] Local fake endpoint 證明 installers 先於 manifest、Beta/Stable 隔離、同 identity retry idempotent、conflicting hash 拒絕。
- [ ] 發布成功產生不含 secret 的 promotion receipt；任何中途失敗不留下可被 client 接受的部分 promotion。
