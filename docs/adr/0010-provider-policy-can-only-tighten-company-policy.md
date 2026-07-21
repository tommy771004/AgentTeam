---
status: accepted
---

# Provider policy can only tighten company policy

Outbound protection has two JSON layers: one Company Base Policy supplies the security floor for every provider, and one Provider Supplemental Policy adds connection-specific protection. Composition is monotonic: detector sets and exclusion ranges are unions, requirements may only become stricter, and a supplement cannot disable, remove, or override a base rule. This retains provider flexibility without introducing bidirectional override precedence or allowing a provider exception to weaken company protection.
