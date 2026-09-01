# 19 — Production unused-code enforcement

**What to build:** 清除 production scopes 中已知的 unused imports／locals，並建立不要求一次清理整個 vendored/test 世界的 blocking warning budget。

**Blocked by:** 14 — Task run admission／finalization prefactor；15 — Pi Host turn routing prefactor；16 — External CLI provider parser prefactor；17 — Startup recovery phase prefactor。

**Status:** 已完成

- [x] Current production unused warnings 歸零或由明確非-production scope 隔離，沒有用重新命名成底線掩蓋真正死碼。
- [x] Blocking lint policy 覆蓋 renderer 與 Electron production modules，並對 generated/vendor/test exceptions 有窄且文件化的邊界。
- [x] 新 unused import/local fixture 會讓 deterministic qualification 失敗。
- [x] 清理不改變 runtime registration、side-effect imports、protocol handlers 或 extension pack discovery。
- [x] Lint output 保持可讀，既有 intentional control-regex 等不同類型 warnings 不被冒充為本票已解決。

## Implementation evidence

- `check:unused-production` runs `oxlint src electron/. -A all -D no-unused-vars`: zero warning budget for shipped renderer/Electron code, while generated/vendor/test scopes and unrelated lint categories stay outside this narrowly blocking policy. The `electron/.` spelling also remains compatible with the no-App-launch sentinel without weakening its exact-binary detection.
- Removed all 14 reported unused imports/locals without underscore renaming; the SubDesign reference metadata now persists the previously computed visual note instead of discarding it.
- A temporary unused import/local fixture deterministically produces a non-zero lint exit, and that fixture smoke is wired into deterministic qualification through `check:pi-contract`.
- Production build and the blocking unused policy pass. The ordinary lint still separately reports four pre-existing intentional `no-control-regex` warnings, so they are not misrepresented as fixed here.
