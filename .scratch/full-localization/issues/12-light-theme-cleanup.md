# 12 — light theme class hack 清償

**What to build:** 淺色主題不再依賴對 class 名稱的廣域 CSS override 猜測，改由元件掛明確的語義 class。使用者這一側：淺色模式視覺穩定，不會因為某個元件改了 class 名稱就破版。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] 移除依 class 名稱模式匹配的廣域 override
- [ ] 需要主題差異的元件掛明確語義 class
- [ ] 深色與淺色兩主題逐頁視覺比對無退化
