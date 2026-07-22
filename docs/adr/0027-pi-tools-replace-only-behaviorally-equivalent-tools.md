# Pi tools replace only behaviorally equivalent tools

Pi's built-in `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls` tools become canonical and legacy tools with the same behavior are removed rather than aliased or retained in parallel. Removal requires contract tests proving parity across parameter schemas, success and error results, streaming updates, cancellation, project scope, and session recording; any unmatched SubAgents behavior is supplied by a Pi tool wrapper or a separately named extension tool before the legacy implementation is deleted.
