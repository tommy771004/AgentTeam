# 08 — Read and search projects with Equivalent Pi Tools

**What to build:** Replace legacy read-only project tools with Pi's canonical read and search tools after proving their externally visible contracts are equivalent.

**Blocked by:** 06 — Run the first Pi-backed Chat turn.

**Status:** resolved

- [x] Contract fixtures compare parameters, validation, results, errors, updates, cancellation, project scope, and session recording.
- [x] Pi `read`, `grep`, `find`, and `ls` activity appears as structured Host items in the desktop UI.
- [x] Project/cwd boundaries match the selected session and cannot silently drift.
- [x] A legacy tool is disabled only after its Pi counterpart passes the full contract matrix.
- [x] The model sees no duplicate or aliased names for migrated tools.

## Answer

Added scoped Pi equivalent read/search tool contracts and black-box fixtures for read, list, find, grep, and path escape rejection.
