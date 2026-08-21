# 08 — Streaming artifact envelope 與 sandbox renderer

Status: 可交給代理

## Parent

[Integrate Open Design harness contracts into SubDesign](../spec.md)

## What to build

讓 provider 以產品擁有的 streaming artifact envelope 更新預覽，明確區分 streaming、complete 與 error，並由 renderer capability declaration 決定 sandbox、streaming 與 export 行為。完成後 navigation/reload 可從 Host state 重建預覽。

## Acceptance criteria

- [ ] Artifact envelope 具 version、artifact identity、ordered updates、terminal status 與 project-relative output references。
- [ ] Artifact manifest 保持 status、renderer 與 exports 的 source of truth；stream event 不建立第二份 canonical artifact state。
- [ ] Renderer 明確宣告支援的 artifact kinds、streaming support、sandbox policy 與 export capability。
- [ ] 不支援 streaming 的 renderer 在開始前拒絕該模式並提供可理解 fallback，而不是顯示半成品。
- [ ] Streaming、complete、error 與 cancelled 狀態在 preview 和 conversation activity 中一致。
- [ ] Sandboxed generated HTML/SVG 沿用受控 bridge，不能直接取得 filesystem、process、network、connector 或 raw token access。
- [ ] Ordered update、duplicate event、out-of-order event、cancel 與 late event 都有 deterministic reconciliation。
- [ ] 切換功能或 reload 後，UI Projection 從 Host snapshot 加 cursor events 重建，不依賴 renderer localStorage 復活舊 artifact。
- [ ] Content 在無 animation、JS throttled 或 screenshot capture 下仍預設可見，不以入口動畫隱藏必要內容。
- [ ] Smoke 覆蓋 complete stream、error stream、unsupported renderer、cancel、event replay、sandbox violation 與 export eligibility。

## Blocked by

- 07 — MCP Apps direction、form、confirmation surfaces
