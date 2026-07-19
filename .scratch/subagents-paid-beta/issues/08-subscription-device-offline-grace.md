# 08 — 完成訂閱、裝置啟用與離線寬限

**What to build:** Let an individual buy, activate, use, cancel, and recover a predictable fixed-seat Pro subscription without sending project content to the service.

**Blocked by:** 07 — 建立 Free Core Entitlement Boundary.

**Status:** ready-for-agent

- [ ] US$9/month and US$90/year subscription options are represented by the product and website checkout flow.
- [ ] Successful purchase activates a Pro entitlement for a bounded number of user devices.
- [ ] The app can refresh entitlement state without uploading source code, prompts, transcripts, or Handoff content.
- [ ] A documented offline grace period permits local work during temporary network loss.
- [ ] Expiry, cancellation, refund, device removal, and reactivation states are handled explicitly.
- [ ] Expired or cancelled Pro stops future paid downloads while preserving Free Core and existing local data.
- [ ] Account, payment, webhook, and entitlement failures produce actionable user-facing messages.
