# Retry interrupted runs only from replay-safe checkpoints

Queued Task runs resume after Pi Host restart, but an active run becomes `interrupted` because its last side effect may be uncertain. Automatic retry is allowed only when a durable Replay-safe Checkpoint proves that no effectful action occurred afterward or that every later action is idempotent under its recorded identity; otherwise interactive runs require manual retry and unattended runs receive an explicit failed settlement.
