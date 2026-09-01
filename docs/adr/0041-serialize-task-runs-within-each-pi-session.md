# Serialize Task runs within each Pi session

Different parent and Child Pi Sessions may execute concurrently within the configured global capacity, but one Pi session admits only one active Task run at a time. Composer steer input joins the active Pi turn while queued input becomes a later Task run; runs never concurrently mutate one session's history, active tools, or compaction state, and global `isRunning` is only a UI projection rather than an execution lock.

Queued interactive runs retain the parent conversation's frozen execution profile, including temporary-chat and memory policy. Answered and failed turns automatically drain the next queued run. An interrupted turn instead marks later same-session queue entries as auto-start paused; editing, reordering, and cancellation remain available, but execution resumes only through an explicit Host `runs/start` transition.
