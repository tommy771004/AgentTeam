# Migrate to Pi Core through removable compatibility seams

The replacement proceeds incrementally behind explicit feature flags: Pi Core Host and protocol first, followed by settings, sessions and models, Equivalent Tools, capabilities, orchestration, Extension Packs, and final UI-state cutover. Each phase must pass behavioral parity and name the legacy modules it deletes; old and new runtimes may coexist only inside a time-bounded migration seam, never as a permanent dual architecture.
