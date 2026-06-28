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

**High Memory Tab**:
A tab whose associated Chrome process memory estimate crosses the product's cleanup threshold.
_Avoid_: memory leak, heavy page, high JS heap
