# Use chrome.processes for memory estimates

Tab Out will use `chrome.processes` for high-memory tab indicators because it is the closest extension API to Chrome process memory and better matches the user's cleanup intent than page-level JavaScript heap APIs. This adds a more sensitive and less universally available permission, so the UI should treat memory values as process-level estimates rather than exact per-tab ownership.
