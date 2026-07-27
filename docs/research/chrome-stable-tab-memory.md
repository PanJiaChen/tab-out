# 稳定版 Chrome 中查看高内存 tab 的可行入口

Research date: 2026-07-10

## 简短结论

在非 Dev/Canary 的稳定版 Chrome 里，用户手动判断“当前哪些 tab 内存占用高”的首选入口是 Chrome Task Manager：官方 DevTools 文档明确说它是实时监控起点，可以看到页面使用的内存，并解释 `Memory footprint` 代表 OS memory、`JavaScript Memory` 代表 JS heap。[Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems#monitor-memory-use-in-realtime-with-the-chrome-task-manager)

DevTools 的 Performance、Performance monitor、Memory panel 适合对某一个已选页面做进一步诊断，不是跨所有 tab 的排行榜：Performance panel 可以记录页面内存随时间变化，Performance monitor 实时显示当前站点的 CPU、JS heap、DOM nodes 等指标，Memory panel 的 heap snapshot 展示某个时间点页面 JS objects 和 DOM nodes 的内存分布。[Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems#visualize-memory-leaks-with-performance-recordings) [Chrome DevTools: Performance monitor panel](https://developer.chrome.com/docs/devtools/performance-monitor) [Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems#discover-detached-dom-tree-memory-leaks-with-heap-snapshots)

对 Tab Out 这样的 Chrome extension，稳定版 extension API 不能可靠获取“每个 tab 的精确内存 MB”。最接近的 `chrome.processes` API 明确标注 `Availability: Dev channel`，并且它返回的是 process 级 `privateMemory`，tab 只是 `tasks[]` 里的可选 `tabId` 关联；这既不能在稳定版发布路径依赖，也不是严格的 per-tab 分摊值。[chrome.processes API](https://developer.chrome.com/docs/extensions/reference/api/processes)

稳定版可用的产品信号应来自 `chrome.tabs` 的状态字段，例如 `active`、`discarded`、`frozen`、`autoDiscardable`、`lastAccessed`、`audible`、`pinned`，以及整机级 `chrome.system.memory.getInfo()`；这些只能表达 tab 状态、最近活跃度或整机内存压力，不能表达某个 tab 的精确内存占用。[chrome.tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab) [chrome.system.memory API](https://developer.chrome.com/docs/extensions/reference/api/system/memory)

## 用户手动查看入口

### 1. Chrome Task Manager

操作步骤：

1. 从 Chrome 主菜单进入 `More tools > Task manager`。Chrome DevTools 和 Chrome Help 都把它列为普通桌面版 Chrome 的正式入口。[Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems#monitor-memory-use-in-realtime-with-the-chrome-task-manager) [Google Chrome Help: Manage tabs](https://support.google.com/chrome/answer/2391819)
2. Windows/Linux 等环境也可尝试 `Shift+Esc`，但不能把它作为跨平台唯一入口；在部分 macOS 环境中不会触发，应使用菜单入口。
3. 查看并按 `Memory footprint` 列排序，用它找当前 OS memory 占用较高的页面；官方说明 `Memory footprint` 代表 OS memory。[Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems#monitor-memory-use-in-realtime-with-the-chrome-task-manager)
4. 如需区分 JS heap，右键 Task Manager 表头并启用 `JavaScript memory`；官方说明该列展示 JS heap，其中括号内 live number 代表页面 reachable objects 正在使用的内存。[Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems#monitor-memory-use-in-realtime-with-the-chrome-task-manager)

可用性判断：这些说明来自 Chrome DevTools 官方文档和 Google Chrome Help 的普通 Chrome 功能说明，没有 Dev/Canary channel 限制；它们是稳定版 Chrome 用户可以使用的手动入口。[Chrome DevTools overview](https://developer.chrome.com/docs/devtools/overview) [Chrome keyboard shortcuts](https://support.google.com/chrome/answer/157179)

### 2. Tab hover memory usage 和 Performance settings

Chrome Help 说明可以在 `Settings > Appearance` 中打开或关闭 tab hover preview card 上的 memory usage 显示；Windows/Linux/Chromebook 路径是 `Tab hover preview card > Show tab memory usage`，Mac 路径是 `Show memory usage on tab hover preview card`。[Personalize Chrome performance](https://support.google.com/chrome/answer/12929150)

这个入口适合用户逐个 hover tab 看当前提示值，但官方文档没有把它描述为可排序的全局 tab 内存列表；所以它可以作为快速查看单个 tab 的辅助入口，不能替代 Task Manager 的跨 tab 排序。[Personalize Chrome performance](https://support.google.com/chrome/answer/12929150)

Chrome Help 还说明 `Performance issue alerts` 会在浏览性能较差时发送建议 tab deactivation 的通知，并允许用户点击 `Fix now`；这属于 Chrome 主动提示，不是用户随时可查询的精确 per-tab 内存 API。[Personalize Chrome performance](https://support.google.com/chrome/answer/12929150)

### 3. DevTools Performance / Performance monitor / Memory panel

Chrome DevTools 是内置在 Google Chrome 里的开发者工具。[Chrome DevTools overview](https://developer.chrome.com/docs/devtools/overview)

适用方式：

1. 已经从 Task Manager 或 hover card 判断某个页面可疑后，打开该页面的 DevTools。
2. 在 Performance panel 勾选 `Memory` 并录制，观察 JS heap、documents、DOM nodes、listeners、GPU memory 等随时间变化；官方文档把它定位为页面内存随时间变化的可视化诊断。[Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems#visualize-memory-leaks-with-performance-recordings)
3. 打开 Performance monitor，可实时看当前站点的 CPU usage、JavaScript heap size、DOM nodes、event listeners、documents、frames、layouts 和 style recalculations 等指标。[Chrome DevTools: Performance monitor panel](https://developer.chrome.com/docs/devtools/performance-monitor)
4. 打开 Memory panel 可做 heap snapshot 或 allocation profiling，官方说明 heap snapshot 展示某个时间点页面 JS objects 和 DOM nodes 的内存分布，allocation sampling 会按 JavaScript function 展示内存分配。[Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems#discover-detached-dom-tree-memory-leaks-with-heap-snapshots) [Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems#investigate-memory-allocation-by-function)

边界：这些 DevTools 工具用于“当前 inspected page / site”的诊断；它们适合找内存泄漏、DOM 节点增长、JS heap 增长原因，不适合直接替代 Task Manager 去列出所有打开 tab 的总内存排名。[Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems)

## 非 Dev/Canary Chrome 是否能用

能用的用户入口：

- Chrome Task Manager：Chrome Help 和 DevTools 官方文档都给出主菜单 `More tools > Task manager` 路径；这是 macOS 上快捷键不可用时的可靠入口。[Google Chrome Help: Manage tabs](https://support.google.com/chrome/answer/2391819) [Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems#monitor-memory-use-in-realtime-with-the-chrome-task-manager)
- Chrome Performance settings、Memory Saver、tab hover memory usage：Chrome Help 面向普通 desktop Chrome 用户说明这些设置路径，并只排除了 iOS/Android 的 performance personalization。[Personalize Chrome performance](https://support.google.com/chrome/answer/12929150)
- Chrome DevTools：官方说明 DevTools built directly into Google Chrome，并提供普通打开方式。[Chrome DevTools overview](https://developer.chrome.com/docs/devtools/overview)

不能作为稳定版 extension 依赖的入口：

- `chrome.processes`：官方 extension API 页面把该 API 标为 `Availability: Dev channel`；即使它有 `getProcessIdForTab()`、`getProcessInfo(includeMemory)`、`privateMemory`、`jsMemoryUsed` 等能力，也不属于稳定版 extension 发布路径。[chrome.processes API](https://developer.chrome.com/docs/extensions/reference/api/processes)
- Chrome Task Manager 原生窗口：Chrome 没有提供 extension API 去执行这个浏览器内置命令。`chrome.commands` 只能定义并接收 extension 自己的命令，而且浏览器/系统快捷键优先，extension 不能覆盖。[chrome.commands API](https://developer.chrome.com/docs/extensions/reference/api/commands) Chromium 当前正式 `chrome://` WebUI host 列表也没有 `task-manager`，因此不存在可由 Tab Out 安全打开的稳定 `chrome://task-manager` 入口。[Chromium WebUI URL constants](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/webui_url_constants.cc)

## 对 Tab Out 的产品/API 影响

### 不应承诺精确 per-tab memory

Tab Out 不应在稳定版里展示“每个 tab 当前精确占用 N MB”的产品承诺。官方 extension API 中真正接近 process memory 的 `chrome.processes` 只在 Dev channel 可用；它的 `privateMemory` 是 process 级字段，而 `tasks[]` 只是 process 下任务列表，`TaskInfo.tabId` 还是可选字段。[chrome.processes API](https://developer.chrome.com/docs/extensions/reference/api/processes)

`chrome.system.memory.getInfo()` 只能获取 physical memory 的 `capacity` 和 `availableCapacity`，是整机级内存信息，不包含 tabId 或 processId，因此可用于整体内存压力提示，不能用于 per-tab 排名。[chrome.system.memory API](https://developer.chrome.com/docs/extensions/reference/api/system/memory)

`chrome.debugger` 是稳定版可用的调试传输 API，可以 attach 到 tab 并发送 Chrome DevTools Protocol commands，但它需要 `"debugger"` 权限，且安装时会触发高敏感度警告；该权限不能作为 optional permission。其允许列表包含 `Runtime`、`Performance`、`Target` 和 `Tracing`，但不包含 CDP `Memory` 或 `SystemInfo` domain。[chrome.debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger) [Chrome permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list#debugger) [chrome.permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions#permissions-that-can-not-be-specified-as-optional)

通过允许的 `Runtime.getHeapUsage`，extension 理论上能得到对应 V8 isolate 的 JS heap，但该方法是 experimental、isolate-scoped，不是 OS/process/tab 总内存；`Performance.getMetrics` 也只承诺返回 runtime metric 的 name/value。[CDP Runtime.getHeapUsage](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage) [CDP Performance.getMetrics](https://chromedevtools.github.io/devtools-protocol/tot/Performance/#method-getMetrics) `Tracing.requestMemoryDump` 还能请求 experimental global memory dump，但 MemoryInfra 结果按 process/subsystem 组织，仍不能无歧义拆成 per-tab 数字。[CDP Tracing](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/#method-requestMemoryDump) [Chromium MemoryInfra](https://chromium.googlesource.com/chromium/src/+/main/docs/memory-infra/README.md)

这里还有结构性归因问题：一个 tab 可因 out-of-process iframe 或 worker 对应多个 target/process；同一个 renderer process 也可能因 process reuse 承载多个 tab/task。Chromium Task Manager 本身会按 process 分组 documents/workers，并说明来自多个 tab 的 subframe 可能共享 process。由此可知，即便获得 process memory，也不能直接当成某个 tab 的精确占用。[chrome.debugger: Work with frames](https://developer.chrome.com/docs/extensions/reference/api/debugger#work-with-frames) [Chromium: Process Model and Site Isolation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/process_model_and_site_isolation.md#visualizations)

### 可以做的稳定版近似信号

Tab Out 可以用这些 stable `chrome.tabs` 字段构造“内存友好/可清理”状态，而不是内存 MB：

- `discarded`：表示 tab content 已从内存卸载，但 tab 仍显示在 tab strip，激活时重新加载；该字段和 `tabs.discard()` 从 Chrome 54+ 可用。[chrome.tabs Tab.discarded](https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab) [chrome.tabs.discard](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-discard)
- `frozen`：Chrome 132+，表示 tab 不能执行 tasks、event handlers 或 timers，但内容仍 loaded in memory，激活时解冻。[chrome.tabs Tab.frozen](https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab)
- `active`：表示 tab 是否是其 window 里的 active tab；这不等于 window focused。[chrome.tabs Tab.active](https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab)
- `lastAccessed`：Chrome 121+，记录 tab 最近成为其 window active tab 的 epoch milliseconds，可用于“很久没访问”的排序。[chrome.tabs Tab.lastAccessed](https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab)
- `autoDiscardable`：Chrome 54+，表示资源不足时 browser 是否可以自动 discard 该 tab。[chrome.tabs Tab.autoDiscardable](https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab)
- `audible` 和 `pinned`：可用来解释为什么某些 tab 不适合作为清理候选；Chrome Help 也列出 active audio/video、pinned tabs 等活动或设置可能阻止 tab deactivation。[chrome.tabs Tab.audible](https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab) [chrome.tabs Tab.pinned](https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab) [Personalize Chrome performance](https://support.google.com/chrome/answer/12929150)

产品建议：

- UI 文案用“Inactive / discarded / frozen / old tab / likely safe to clean up”这类状态表达，不用“high memory tab”或“uses X MB”，除非只是引导用户去 Chrome Task Manager 手动确认。[chrome.tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- 如果要释放资源，可以对非 active、可丢弃 tab 提供 `discard` 操作；官方说明 `chrome.tabs.discard()` 会从内存 discard tab，discarded tab 仍在 tab strip 中，激活时重新加载，且 active 或已 discarded 的 tab 不会被 discard。[chrome.tabs.discard](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-discard)
- 可以保留整机级 memory pressure 指标，例如 “Chrome reports low available system memory”，但数据来源应标明是 device-wide physical memory，而不是 tab-level memory。[chrome.system.memory API](https://developer.chrome.com/docs/extensions/reference/api/system/memory)

## Sources

- [Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems)
- [Chrome DevTools: Performance monitor panel](https://developer.chrome.com/docs/devtools/performance-monitor)
- [Chrome DevTools overview](https://developer.chrome.com/docs/devtools/overview)
- [Google Chrome Help: Chrome keyboard shortcuts](https://support.google.com/chrome/answer/157179)
- [Google Chrome Help: Personalize Chrome performance](https://support.google.com/chrome/answer/12929150)
- [Chrome Extensions API: chrome.processes](https://developer.chrome.com/docs/extensions/reference/api/processes)
- [Chrome Extensions API: chrome.tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome Extensions API: chrome.system.memory](https://developer.chrome.com/docs/extensions/reference/api/system/memory)
- [Chrome Extensions API: chrome.debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Chrome Extensions API: chrome.commands](https://developer.chrome.com/docs/extensions/reference/api/commands)
- [Chrome DevTools Protocol: Runtime domain](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/)
- [Chrome DevTools Protocol: Performance domain](https://chromedevtools.github.io/devtools-protocol/tot/Performance/)
- [Chrome DevTools Protocol: Tracing domain](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/)
- [Chromium: Process Model and Site Isolation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/process_model_and_site_isolation.md)
- [Chromium MemoryInfra](https://chromium.googlesource.com/chromium/src/+/main/docs/memory-infra/README.md)
