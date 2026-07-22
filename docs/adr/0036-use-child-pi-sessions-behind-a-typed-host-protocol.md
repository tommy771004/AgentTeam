# Use Child Pi Sessions behind a typed host protocol

The Electron/React renderer controls a Pi Core Host through typed requests and streamed events rather than invoking or parsing the Pi CLI. The Delegation Extension creates an independent Child Pi Session for each subagent, applies its Effective Agent Profile and explicit Context Packet, and returns a result summary to the durable parent session; role switching inside one shared transcript and wholesale parent-transcript inheritance are rejected to preserve isolation and inspectability.
