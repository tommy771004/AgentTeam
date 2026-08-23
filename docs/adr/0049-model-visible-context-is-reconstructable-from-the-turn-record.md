# Model-visible context is reconstructable from the Turn Record

Anything that reaches a model request must be reconstructable from the Pi Core Host's Turn Record. The record is the only write path for the model's history: `messages` is derived from it, never accumulated beside it, so a run's context and its account of itself cannot drift apart. A new kind of model-visible input therefore requires a new record entry kind — not a second store, and not a field bolted onto an existing message.

This exists because the same value was previously assembled three times over — once for the settled answer, once for the history, once for the UI — and a defect in one could not be contradicted by the others: a turn published its opening narration as the answer, wrote that same text into its history, and every surface agreed the run had succeeded.

Two consequences bind implementations. Deriving the answer belongs to the shared derivation module and nowhere else, so no consumer may select it by indexing a turn's items; a drift guard fails the build on a new one. And an entry records who is accountable for it (ADR-0048): what the user said, what the model claimed or asked for, and what the Host actually did are different classes of fact and never collapse into one.
