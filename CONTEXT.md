# Tab Out

Tab Out is a Chrome extension that helps users inspect, group, and clean up their open browser tabs from the new tab page.

## Language

**Active Tab**:
A tab that is currently selected in its Chrome window.
_Avoid_: active page, unactive tab

**Background Tab**:
A tab that is open but not currently selected in its Chrome window.
_Avoid_: unactive tab, inactive tab

**Sleeping Tab**:
A tab whose page contents have been released from memory by Chrome and will reload when selected again.
_Avoid_: unactive tab, inactive tab, closed tab

**Frozen Tab**:
A tab whose page contents remain in memory, but Chrome has paused task execution to reduce background work.
_Avoid_: sleeping tab, discarded tab, closed tab

**System Memory Snapshot**:
A point-in-time reading of device-wide physical memory from `chrome.system.memory.getInfo()`, including total and available capacity. It is not Chrome's own memory usage.
_Avoid_: Chrome memory, browser memory, tab memory
