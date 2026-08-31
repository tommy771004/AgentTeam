# 19 — Production unused-code enforcement

**What to build:** 清除 production scopes 中已知的 unused imports／locals，並建立不要求一次清理整個 vendored/test 世界的 blocking warning budget。

**Blocked by:** 14 — Task run admission／finalization prefactor；15 — Pi Host turn routing prefactor；16 — External CLI provider parser prefactor；17 — Startup recovery phase prefactor。

**Status:** 可交給代理

- [ ] Current production unused warnings 歸零或由明確非-production scope 隔離，沒有用重新命名成底線掩蓋真正死碼。
- [ ] Blocking lint policy 覆蓋 renderer 與 Electron production modules，並對 generated/vendor/test exceptions 有窄且文件化的邊界。
- [ ] 新 unused import/local fixture 會讓 deterministic qualification 失敗。
- [ ] 清理不改變 runtime registration、side-effect imports、protocol handlers 或 extension pack discovery。
- [ ] Lint output 保持可讀，既有 intentional control-regex 等不同類型 warnings 不被冒充為本票已解決。
