# Isolate model-generated code from trusted extensions

Trusted Extensions follow Pi's full-process trust model, but model-generated JavaScript does not inherit that authority. The Capability Extension retains `run_code` in an isolated worker with direct Node, filesystem, process, and network access disabled; generated programs may only coordinate currently active Pi tools, and each nested invocation remains separately recorded, cancellable, and subject to the tool lifecycle.
