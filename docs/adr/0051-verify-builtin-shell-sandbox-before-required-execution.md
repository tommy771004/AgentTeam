---
status: accepted
---

# Verify the builtin shell sandbox before required execution

## Context

ADR-0022 requires verified filesystem isolation for external CLI runs, but its
seatbelt and bwrap path does not wrap Pi Core's builtin `bash`. ADR-0047
therefore keeps that builtin fail-closed under Outbound Guard `required`.
Allowing a renderer boolean, a tool argument, or model text to lift this refusal
would violate ADR-0048: a model cannot manufacture execution evidence.

This decision defines the contract a platform adapter must satisfy before it
may be enabled. The macOS (Seatbelt) and Linux (bubblewrap) adapters now
implement it; Windows has none.

## Decision

Builtin shell isolation is a Host-owned deep module with four observable
outcomes: `supported+verified`, `unsupported`, `probe-failed`, and
`canary-failed`. Merely finding a backend binary never produces verification.
The trusted main-side adapter must first probe a concrete backend/profile and
then run two canaries with that exact profile: a file inside the frozen
Restricted Project View must be readable and a Host-created file outside that
view must be denied. Both observations are required.

Only this verifier may issue an isolation evidence object. The evidence is
metadata-only and binds the run id, backend id, profile digest, canonical view
root, issuance and expiry times, and a same-run replay nonce. The Host keeps an
in-memory issuance registry, so a structurally identical object deserialised
from IPC, model text, or tool arguments is not evidence. Validation rejects a
missing or malformed object, an unknown issuance, expiry, run/view mismatch,
profile mismatch, or a failed canary.

`required` execution may proceed only through the verified adapter represented
by that evidence. `unsupported`, probe failure, and canary failure are explicit
refusals; none silently becomes optional execution. `optional` and `off` keep
the degraded/unrestricted meanings recorded by ADR-0047. A platform with no
installed adapter reports `unsupported`, so ADR-0047's real-turn fail-closed
behavior is unchanged there.

Verification is not permission. The adapter that proved the sandbox also owns
execution: it prepares the run's confinement and rewrites the admitted command
to run inside it, passing the command through whole so the string the Approval
Decision inspected is the string that runs. A backend with no wrapper, a
wrapper that fails, or evidence naming a backend other than the installed one
is a refusal — an admitted-but-unwrapped shell would run unconfined behind an
audit trail claiming it was sandboxed, which is worse than refusing. Keeping
the verifier and the wrapper in one owner is what stops a separately registered
wrapper from confining commands with a policy nothing ever tested.

## Consequences

The macOS and Linux adapters implement this contract rather than reusing the
external-CLI capability boolean, and each builds its own profile: the Seatbelt
SBPL profile and the bubblewrap argv are separate from ADR-0022's, so a change
made for the external CLI cannot silently move the builtin shell's boundary.
Both deny the network — for bubblewrap that means the network namespace is
unshared, which ADR-0022's argv does not do.

Windows and every unimplemented platform are honestly unsupported.
Verification data contains no command, file contents, credentials, or
environment values, and renderer/preload surfaces expose no evidence
constructor or registration path.

A profile digest identifies the POLICY, not the instance: the view root is
bound separately in the evidence, so one backend keeps one recognisable
profile identity across runs while each run stays pinned to its own view.

Related: ADR-0022, ADR-0047, ADR-0048.
