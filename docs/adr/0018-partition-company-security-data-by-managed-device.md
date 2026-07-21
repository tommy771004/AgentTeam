---
status: accepted
---

# Partition company security data by managed device

Classifier requests, pending evidence, and Workspace evidence storage carry the same Managed Device ID and are partitioned by `workspaceId + deviceId`. The identifier is stable and opaque rather than derived from hostname, user identity, MAC address, disk serial, or another hardware attribute. Sources remain separate chunks within each device partition, preserving locator integrity while allowing a company to query many computers without mixing their records.

Workspace policy source receives an immutable device ID from the server during first authenticated enrollment. Local and demo sources generate an opaque UUID in Electron main. A separate human-readable device label may change without changing identity; reinstalling creates a new device unless Workspace performs an explicit re-enrollment, and hardware fingerprinting is never used to recover identity.

Enrollment also provisions a per-device evidence HMAC key, stored through Electron main OS safe storage and retained by Workspace for central verification. Re-enrollment rotates the active key while historical device keys remain available only for verifying evidence produced before rotation.

Replacing a computer always enrolls a new device ID and HMAC key. Workspace retires the old device and revokes its active synchronization/upload credential while retaining its identity and historical keys solely for evidence verification. A `device-replaced` event links the new ID to the retired ID without transferring the old key or policy cache; any evidence stranded on a lost device is represented as an unrecoverable gap rather than silently reconstructed.
