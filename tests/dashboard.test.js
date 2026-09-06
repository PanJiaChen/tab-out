import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { URL } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';

const indexPath = new URL('../extension/index.html', import.meta.url);
const appPath = new URL('../extension/app.js', import.meta.url);
const extensionUrl = 'chrome-extension://tab-out-test/index.html';
const gib = 1024 ** 3;
const reviewNow = new Date('2026-09-06T12:00:00Z');

function staleTab(id, overrides = {}) {
  return tab({ id, url: `https://review.test/page-${id}`, title: `Review page ${id}`, index: id - 1,
    lastAccessed: reviewNow.getTime() - 20 * 86400000, ...overrides });
}

function expandReview(document, label = 'Review Test') {
  const queue = within(document.body).getByRole('region', { name: /needs review/i });
  const show = within(queue).queryByRole('button', { name: 'Show Needs review' });
  if (show) fireEvent.click(show);
  fireEvent.click(within(document.body).getByRole('button', { name: `Review ${label}` }));
}

async function actOnReview(document, id, action) {
  fireEvent.click(within(document.querySelector(`[data-review-row-id="${id}"]`)).getByRole('button', { name: action }));
  await flushAsyncWork();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flushAsyncWork() {
  await nextTurn();
}

function tab(overrides) {
  return {
    id: overrides.id,
    url: overrides.url,
    title: overrides.title || overrides.url,
    windowId: overrides.windowId || 1,
    active: false,
    audible: false,
    pinned: false,
    discarded: false,
    frozen: false,
    autoDiscardable: true,
    ...overrides,
  };
}

async function loadDashboard({ tabs: initialTabs, deferred = [] }) {
  const html = await readFile(indexPath, 'utf8');
  const appSource = await readFile(appPath, 'utf8');
  const dom = new JSDOM(html, {
    url: extensionUrl,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  dom.window.setTimeout = globalThis.setTimeout;
  dom.window.clearTimeout = globalThis.clearTimeout;
  dom.window.Date = Date;
  const audioContext = vi.fn(() => {
    throw new Error('AudioContext invocation captured by test');
  });
  dom.window.AudioContext = audioContext;

  let tabs = initialTabs.map(item => ({ ...item }));
  let nextTabId = Math.max(0, ...tabs.map(item => item.id)) + 1;
  const storage = { deferred: structuredClone(deferred) };
  const chrome = {
    runtime: { id: 'tab-out-test' },
    tabs: {
      query: vi.fn(async () => tabs.map(item => ({ ...item }))),
      discard: vi.fn(async () => {}),
      remove: vi.fn(async tabIds => {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        tabs = tabs.filter(item => !ids.includes(item.id));
      }),
      update: vi.fn(async (id, patch) => {
        const current = tabs.find(item => item.id === id);
        if (patch.active) tabs.filter(item => item.windowId === current.windowId).forEach(item => { item.active = false; });
        Object.assign(current, patch);
        return { ...current };
      }),
      create: vi.fn(async options => {
        const created = tab({ id: nextTabId++, ...options, title: options.url, lastAccessed: Date.now() });
        tabs.push(created);
        return { ...created };
      }),
    },
    windows: {
      getCurrent: vi.fn(async () => ({ id: 1 })),
      get: vi.fn(async id => ({ id })),
      update: vi.fn(async () => {}),
    },
    storage: {
      local: {
        get: vi.fn(async key => structuredClone({ [key]: storage[key] || [] })),
        set: vi.fn(async patch => Object.assign(storage, structuredClone(patch))),
      },
    },
    system: {
      memory: {
        getInfo: vi.fn(callback => {
          const info = {
            capacity: 16 * gib,
            availableCapacity: 4 * gib,
          };
          if (typeof callback === 'function') {
            callback(info);
            return undefined;
          }
          return Promise.resolve(info);
        }),
      },
    },
  };

  dom.window.chrome = chrome;
  dom.window.console = console;
  dom.window.eval(appSource);
  await flushAsyncWork();

  return {
    audioContext,
    chrome,
    storage,
    document: dom.window.document,
    setTabs(nextTabs) {
      tabs = nextTabs.map(item => ({ ...item }));
    },
  };
}

describe('new tab dashboard seam', () => {
  test('renders grouped tabs, saved tabs, and the system memory snapshot', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-05T12:00:00Z') });
    const { document } = await loadDashboard({
      tabs: [
        tab({ id: 1, url: 'https://alpha.test/article', title: 'Alpha article' }),
        tab({ id: 2, url: 'https://beta.test/home', title: 'Beta home', active: true }),
        tab({ id: 3, url: 'https://music.test/player', title: 'Music player', audible: true }),
        tab({ id: 4, url: 'chrome://settings', title: 'Settings' }),
      ],
      deferred: [
        {
          id: 'saved-1',
          url: 'https://later.test/read',
          title: 'Later reading',
          savedAt: '2026-07-05T11:30:00.000Z',
          completed: false,
          dismissed: false,
        },
      ],
    });

    const page = within(document.body);
    expect(page.getByText('Alpha Test')).toBeTruthy();
    expect(page.getByText('Beta Test')).toBeTruthy();
    expect(page.getByText('Music Test')).toBeTruthy();
    expect(page.getByText('Later reading')).toBeTruthy();
    expect(page.getByText('75.0% used')).toBeTruthy();
    expect(page.getByRole('button', { name: /Sleep 1 inactive tab/i })).toBeTruthy();
  });

  test('opens a duplicate review dialog and lets the user close one extra tab at a time', async () => {
    const { audioContext, chrome, document } = await loadDashboard({
      tabs: [
        tab({ id: 1, url: 'https://alpha.test/article', title: 'Alpha article' }),
        tab({ id: 2, url: 'https://alpha.test/article', title: 'Alpha article', active: true }),
        tab({ id: 3, url: 'https://beta.test/research', title: 'Beta research' }),
        tab({ id: 4, url: 'https://beta.test/research', title: 'Beta research' }),
        tab({ id: 5, url: 'https://beta.test/research', title: 'Beta research' }),
        tab({ id: 6, url: 'https://gamma.test/unique', title: 'Gamma note' }),
      ],
    });
    const page = within(document.body);

    fireEvent.click(page.getByRole('button', { name: /Review 3 duplicates/i }));
    await flushAsyncWork();

    const dialog = page.getByRole('dialog', { name: /review duplicate tabs/i });
    expect(within(dialog).getByText('3 extra tabs to review')).toBeTruthy();
    expect(within(dialog).getAllByText('Alpha article').length).toBeGreaterThan(0);

    const alphaKeepButton = within(dialog)
      .getAllByRole('button', { name: /Keep tab: Alpha article/i })
      .find(button => button.getAttribute('aria-pressed') === 'false');
    fireEvent.click(alphaKeepButton);
    await flushAsyncWork();

    fireEvent.click(within(page.getByRole('dialog', { name: /review duplicate tabs/i })).getByRole('button', { name: /Close duplicate tab: Alpha article/i }));
    await flushAsyncWork();

    expect(chrome.tabs.remove).toHaveBeenCalledWith(2);
    expect(audioContext).toHaveBeenCalledTimes(1);
    expect(within(page.getByRole('dialog', { name: /review duplicate tabs/i })).getByText('2 extra tabs to review')).toBeTruthy();
  });

  test('sleep actions optimistically keep earlier tabs sleeping across later tab fetches', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-05T12:00:00Z') });
    const { chrome, document } = await loadDashboard({
      tabs: [
        tab({ id: 1, url: 'https://alpha.test/article', title: 'Alpha article' }),
        tab({ id: 2, url: 'https://beta.test/research', title: 'Beta research' }),
        tab({ id: 3, url: 'https://active.test/current', title: 'Active work', active: true }),
      ],
    });
    const page = within(document.body);
    const alphaCard = document.querySelector('[data-domain-id="domain-alpha-test"]');

    fireEvent.click(within(alphaCard).getByRole('button', { name: /Sleep 1 tab/i }));
    await flushAsyncWork();

    const alphaChip = document.querySelector('[data-tab-id="1"]');
    expect(chrome.tabs.discard).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.discard).toHaveBeenLastCalledWith(1);
    expect(alphaChip.classList.contains('is-sleeping-tab')).toBe(true);
    expect(alphaChip.classList.contains('is-freed-tab')).toBe(true);
    expect(alphaChip.querySelector('.chip-state-bar').getAttribute('aria-label')).toMatch(/Freed by Tab Out/i);

    fireEvent.click(page.getByRole('button', { name: /Sleep 1 inactive tab/i }));
    await flushAsyncWork();

    expect(chrome.tabs.discard.mock.calls.map(([tabId]) => tabId)).toEqual([1, 2]);
    expect(alphaChip.classList.contains('is-sleeping-tab')).toBe(true);
    expect(alphaChip.querySelector('.chip-state-bar').getAttribute('aria-label')).toMatch(/Freed by Tab Out/i);

    vi.advanceTimersByTime(6025);
    await flushAsyncWork();

    expect(alphaChip.classList.contains('is-sleeping-tab')).toBe(true);
    expect(alphaChip.classList.contains('is-freed-tab')).toBe(false);
    expect(alphaChip.querySelector('.chip-state-bar').getAttribute('aria-label')).toMatch(/Sleeping tab/i);
  });

  test('keeps Needs Review collapsed until the user expands its groups', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-05T12:00:00Z') });
    const { document } = await loadDashboard({
      tabs: [
        tab({
          id: 1,
          url: 'https://www.figma.com/file/old-design',
          title: 'Old design',
          lastAccessed: new Date('2026-06-26T12:00:00Z').getTime(),
        }),
        tab({
          id: 2,
          url: 'https://www.figma.com/file/current-design',
          title: 'Current design',
          active: true,
          lastAccessed: new Date('2026-07-05T11:00:00Z').getTime(),
        }),
        tab({
          id: 3,
          url: 'https://www.figma.com/file/reference',
          title: 'Pinned reference',
          pinned: true,
          lastAccessed: new Date('2026-06-20T12:00:00Z').getTime(),
        }),
        tab({
          id: 4,
          url: 'https://www.figma.com/file/old-flow',
          title: 'Old flow',
          lastAccessed: new Date('2026-06-27T12:00:00Z').getTime(),
        }),
        tab({
          id: 5,
          url: 'https://github.com/',
          title: 'GitHub',
          lastAccessed: new Date('2026-06-01T12:00:00Z').getTime(),
        }),
        tab({
          id: 6,
          url: 'https://www.figma.com/file/live-call',
          title: 'Live call',
          audible: true,
          lastAccessed: new Date('2026-06-01T12:00:00Z').getTime(),
        }),
      ],
    });
    const page = within(document.body);
    const firstDomainCard = document.querySelector('.domain-card');

    const reviewQueue = page.getByRole('region', { name: /needs review/i });
    expect(within(reviewQueue).getByRole('button', { name: /show/i }).getAttribute('aria-expanded')).toBe('false');
    expect(within(reviewQueue).queryByText('Figma')).toBeNull();

    fireEvent.click(within(reviewQueue).getByRole('button', { name: /show/i }));

    const expandedQueue = page.getByRole('region', { name: /needs review/i });
    const collapseButton = within(expandedQueue).getByRole('button', { name: /collapse needs review/i });
    expect(collapseButton.getAttribute('aria-expanded')).toBe('true');
    expect(collapseButton.classList.contains('action-btn')).toBe(false);
    expect(within(expandedQueue).getByText('Figma')).toBeTruthy();
    expect(within(expandedQueue).getByText('2 tabs need review · oldest 9 days')).toBeTruthy();
    expect(within(expandedQueue).queryByText('Homepages')).toBeNull();
    expect(document.querySelector('.domain-card') === firstDomainCard).toBe(true);

    fireEvent.click(collapseButton);

    expect(within(page.getByRole('region', { name: /needs review/i })).queryByText('Figma')).toBeNull();
    expect(document.querySelector('.domain-card') === firstDomainCard).toBe(true);
  });

  test('expands stale tabs inline and keeps a single URL for 30 days', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-05T12:00:00Z') });
    const { chrome, document } = await loadDashboard({
      tabs: [
        tab({ id: 1, url: 'https://www.figma.com/file/old-design', title: 'Old design', lastAccessed: new Date('2026-06-26T12:00:00Z').getTime() }),
        tab({ id: 2, url: 'https://www.figma.com/file/current-design', title: 'Current design', active: true, lastAccessed: new Date('2026-07-05T11:00:00Z').getTime() }),
        tab({ id: 3, url: 'https://www.figma.com/file/old-flow', title: 'Old flow', lastAccessed: new Date('2026-06-27T12:00:00Z').getTime() }),
      ],
    });
    const page = within(document.body);
    const firstDomainCard = document.querySelector('.domain-card');
    const collapsedQueue = page.getByRole('region', { name: /needs review/i });
    fireEvent.click(within(collapsedQueue).getByRole('button', { name: /show/i }));
    const reviewQueue = page.getByRole('region', { name: /needs review/i });

    fireEvent.click(within(reviewQueue).getByRole('button', { name: /review figma/i }));
    await flushAsyncWork();

    const expandedReview = page.getByRole('region', { name: /needs review/i });
    expect(within(expandedReview).getByRole('button', { name: 'Old design' })).toBeTruthy();
    expect(within(expandedReview).getByRole('button', { name: 'Old flow' })).toBeTruthy();
    expect(within(expandedReview).queryByRole('button', { name: 'Current design' })).toBeNull();
    expect(document.querySelector('.domain-card') === firstDomainCard).toBe(true);

    const refreshedQueue = page.getByRole('region', { name: /needs review/i });
    const snoozeButton = within(refreshedQueue.querySelector('[data-review-row-id="1"]')).getByRole('button', { name: 'Keep 30d' });
    fireEvent.click(snoozeButton);
    await flushAsyncWork();

    expect(within(page.getByRole('region', { name: /needs review/i })).queryByRole('button', { name: 'Old design' })).toBeNull();
    expect(within(page.getByRole('region', { name: /needs review/i })).getByRole('button', { name: 'Old flow' })).toBeTruthy();
    const [[{ reviewSnoozesByUrl }]] = chrome.storage.local.set.mock.calls.slice(-1);
    expect(Object.keys(reviewSnoozesByUrl).sort()).toEqual([
      'https://www.figma.com/file/old-design',
    ].sort());
  });

  test('shows at most six review groups ordered by their oldest stale tab', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-05T12:00:00Z') });
    const daysAgo = (days) => new Date('2026-07-05T12:00:00Z').getTime() - days * 24 * 60 * 60 * 1000;
    const { document } = await loadDashboard({
      tabs: [
        tab({ id: 1, url: 'https://one.test/old', title: 'One', lastAccessed: daysAgo(8) }),
        tab({ id: 2, url: 'https://two.test/old', title: 'Two', lastAccessed: daysAgo(9) }),
        tab({ id: 3, url: 'https://three.test/old', title: 'Three', lastAccessed: daysAgo(10) }),
        tab({ id: 4, url: 'https://four.test/old', title: 'Four', lastAccessed: daysAgo(11) }),
        tab({ id: 5, url: 'https://five.test/old', title: 'Five', lastAccessed: daysAgo(12) }),
        tab({ id: 6, url: 'https://six.test/old', title: 'Six', lastAccessed: daysAgo(13) }),
        tab({ id: 7, url: 'https://seven.test/old', title: 'Seven', lastAccessed: daysAgo(14) }),
      ],
    });
    const page = within(document.body);
    const collapsedQueue = page.getByRole('region', { name: /needs review/i });
    fireEvent.click(within(collapsedQueue).getByRole('button', { name: /show/i }));
    const reviewQueue = page.getByRole('region', { name: /needs review/i });
    const labels = [...reviewQueue.querySelectorAll('.needs-review-copy strong')].map(item => item.textContent);

    expect(labels).toEqual(['Seven Test', 'Six Test', 'Five Test', 'Four Test', 'Three Test', 'Two Test']);
  });

  test('search shows a flat list for case-insensitive terms and restores domain groups when cleared', async () => {
    const { document } = await loadDashboard({
      tabs: [
        tab({ id: 1, url: 'https://symphony.test/home', title: 'Applied Symphony AI' }),
        tab({ id: 2, url: 'https://other.test/article', title: 'Unrelated article' }),
      ],
    });
    const page = within(document.body);
    const search = page.getByRole('searchbox', { name: /search open tabs/i });

    fireEvent.input(search, { target: { value: 'applied AI' } });

    expect(page.getByText('Search results')).toBeTruthy();
    expect(page.getByText('Applied Symphony AI')).toBeTruthy();
    expect(page.getByText('Symphony Test')).toBeTruthy();
    expect(page.queryByText('Unrelated article')).toBeNull();
    expect(document.querySelector('.mission-card[data-domain-id]')).toBeNull();
    expect(page.getByText('1 match')).toBeTruthy();
    expect(document.getElementById('openTabsSectionCount').textContent).toBe('');

    fireEvent.click(page.getByRole('button', { name: /clear search/i }));

    expect(page.getByText('Symphony Test')).toBeTruthy();
    expect(page.getByText('Other Test')).toBeTruthy();
  });

  test('Ctrl+K focuses Tab Search when the user is not already typing', async () => {
    const { document } = await loadDashboard({
      tabs: [tab({ id: 1, url: 'https://alpha.test/article', title: 'Alpha article' })],
    });
    const search = within(document.body).getByRole('searchbox', { name: /search open tabs/i });

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });

    expect(document.activeElement).toBe(search);
  });

  test('mouse press on the Search trigger moves focus to Tab Search', async () => {
    const { document } = await loadDashboard({
      tabs: [tab({ id: 1, url: 'https://alpha.test/article', title: 'Alpha article' })],
    });
    const page = within(document.body);
    const trigger = page.getByRole('button', { name: /focus tab search/i });
    const search = page.getByRole('searchbox', { name: /search open tabs/i });

    trigger.dispatchEvent(new document.defaultView.Event('mousedown', { bubbles: true, cancelable: true }));

    expect(search.matches(':focus')).toBe(true);
  });
});

describe('inline Needs Review actions', () => {
  test('closes exactly the clicked URL copy and reopens it in its original position', async () => {
    vi.useFakeTimers({ now: reviewNow });
    const first = staleTab(1);
    const second = staleTab(2, { url: first.url, title: 'Second copy', windowId: 2, index: 5 });
    const { document, chrome } = await loadDashboard({ tabs: [first, second] });
    expandReview(document);
    await actOnReview(document, 2, 'Close');
    expect(chrome.tabs.remove.mock.calls).toEqual([[2]]);
    expect(document.querySelector('[data-review-row-id="1"]')).toBeTruthy();
    expect(document.querySelector('[data-review-row-id="2"]')).toBeNull();
    fireEvent.click(within(document.body).getByRole('button', { name: 'Undo' }));
    await flushAsyncWork();
    expect(chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: first.url, windowId: 2, index: 5, active: false });
    expect(document.querySelector('[data-review-row-id="3"]')).toBeTruthy();
    expect(within(document.body).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  test('focuses the clicked copy by ID without closing either copy', async () => {
    vi.useFakeTimers({ now: reviewNow });
    const first = staleTab(1);
    const { document, chrome } = await loadDashboard({ tabs: [first, staleTab(2, { url: first.url, title: 'Other window', windowId: 2 })] });
    expandReview(document);
    fireEvent.click(within(document.body).getByRole('button', { name: 'Other window' }));
    await flushAsyncWork();
    expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(2, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  test('keeps all same-URL copies, persists only that URL, and can retry a storage failure', async () => {
    vi.useFakeTimers({ now: reviewNow });
    const first = staleTab(1);
    const { document, chrome, storage } = await loadDashboard({ tabs: [first, staleTab(2, { url: first.url, windowId: 2 }), staleTab(3)] });
    expandReview(document);
    chrome.storage.local.set.mockRejectedValueOnce(new Error('Storage unavailable'));
    await actOnReview(document, 1, 'Keep 30d');
    expect(document.querySelector('[data-review-row-id="1"]')).toBeTruthy();
    expect(document.querySelector('[data-review-row-id="2"]')).toBeTruthy();
    expect(within(document.body).getByRole('alert').textContent).toMatch(/Storage unavailable/);
    await actOnReview(document, 1, 'Keep 30d');
    expect(storage.reviewSnoozesByUrl).toEqual({ [first.url]: reviewNow.getTime() + 30 * 86400000 });
    expect(document.querySelector('[data-review-row-id="1"]')).toBeNull();
    expect(document.querySelector('[data-review-row-id="2"]')).toBeNull();
    expect(document.querySelector('[data-review-row-id="3"]')).toBeTruthy();
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  test('does not close a page when saving fails', async () => {
    vi.useFakeTimers({ now: reviewNow });
    const { document, chrome, storage } = await loadDashboard({ tabs: [staleTab(1)] });
    expandReview(document);
    chrome.storage.local.set.mockRejectedValueOnce(new Error('Quota exceeded'));
    await actOnReview(document, 1, 'Save & close');
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
    expect(storage.deferred).toEqual([]);
    expect(within(document.body).getByRole('alert').textContent).toMatch(/Quota exceeded/);
  });

  test('retries a failed close without saving twice and Undo removes only its own new record', async () => {
    vi.useFakeTimers({ now: reviewNow });
    const existing = { id: 'old-archive', url: staleTab(1).url, title: 'Archived page', completed: true, savedAt: reviewNow.toISOString() };
    const { document, chrome, storage } = await loadDashboard({ tabs: [staleTab(1)], deferred: [existing] });
    expandReview(document);
    chrome.tabs.remove.mockRejectedValueOnce(new Error('Close failed'));
    await actOnReview(document, 1, 'Save & close');
    expect(storage.deferred).toHaveLength(2);
    expect(within(document.body).getByRole('alert').textContent).toMatch(/Saved, but not closed/);
    await actOnReview(document, 1, 'Save & close');
    expect(storage.deferred).toHaveLength(2);
    fireEvent.click(within(document.body).getByRole('button', { name: 'Undo' }));
    await flushAsyncWork();
    expect(storage.deferred).toEqual([existing]);
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  });

  test('reuses an existing active saved item and leaves it intact on Undo', async () => {
    vi.useFakeTimers({ now: reviewNow });
    const existing = { id: 'existing', url: staleTab(1).url, title: 'Already saved', completed: false, savedAt: reviewNow.toISOString() };
    const { document, storage } = await loadDashboard({ tabs: [staleTab(1)], deferred: [existing] });
    expandReview(document);
    await actOnReview(document, 1, 'Save & close');
    expect(storage.deferred).toEqual([existing]);
    fireEvent.click(within(document.body).getByRole('button', { name: 'Undo' }));
    await flushAsyncWork();
    expect(storage.deferred).toEqual([existing]);
  });

  test('retains only the last successful close for ten seconds and falls back when its window is gone', async () => {
    vi.useFakeTimers({ now: reviewNow });
    const { document, chrome } = await loadDashboard({ tabs: [staleTab(1), staleTab(2, { windowId: 2 })] });
    expandReview(document);
    await actOnReview(document, 1, 'Close');
    vi.advanceTimersByTime(9000);
    await actOnReview(document, 2, 'Close');
    vi.advanceTimersByTime(2000);
    chrome.windows.get.mockRejectedValueOnce(new Error('No window'));
    fireEvent.click(within(document.body).getByRole('button', { name: 'Undo' }));
    await flushAsyncWork();
    expect(chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: staleTab(2).url, active: false, windowId: 1 });
    await actOnReview(document, 3, 'Close');
    vi.advanceTimersByTime(10000);
    expect(within(document.body).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  test('retries Undo after a storage failure without reopening another copy', async () => {
    vi.useFakeTimers({ now: reviewNow });
    const { document, chrome, storage } = await loadDashboard({ tabs: [staleTab(1)] });
    expandReview(document);
    await actOnReview(document, 1, 'Save & close');
    chrome.storage.local.set.mockRejectedValueOnce(new Error('Storage offline'));
    fireEvent.click(within(document.body).getByRole('button', { name: 'Undo' }));
    await flushAsyncWork();
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(storage.deferred).toHaveLength(1);
    fireEvent.click(within(document.body).getByRole('button', { name: 'Undo' }));
    await flushAsyncWork();
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(storage.deferred).toEqual([]);
  });

  test('keeps the original groups and rows across actions, search and collapsing', async () => {
    vi.useFakeTimers({ now: reviewNow });
    const tabs = [staleTab(1), staleTab(2, { url: 'https://second.test/a' }), staleTab(3, { url: 'https://third.test/a' }), staleTab(4, { url: 'https://fourth.test/a', lastAccessed: reviewNow.getTime() - 8 * 86400000 })];
    const { document, setTabs } = await loadDashboard({ tabs });
    expandReview(document);
    setTabs([...tabs, staleTab(5, { url: 'https://new.test/a', lastAccessed: reviewNow.getTime() - 40 * 86400000 }), staleTab(6)]);
    await actOnReview(document, 1, 'Close');
    let queue = within(document.body).getByRole('region', { name: /needs review/i });
    expect(within(queue).getByText(/All reviewed. Choose another group/)).toBeTruthy();
    expect(within(queue).getByRole('button', { name: 'Review Second Test' }).getAttribute('aria-expanded')).toBe('false');
    expect(queue.querySelector('[data-review-row-id="6"]')).toBeNull();
    const search = within(document.body).getByRole('searchbox', { name: /Search open tabs/i });
    fireEvent.input(search, { target: { value: 'anything' } });
    fireEvent.click(within(document.body).getByRole('button', { name: 'Clear search' }));
    queue = within(document.body).getByRole('region', { name: /needs review/i });
    expect([...queue.querySelectorAll('.needs-review-copy strong')].map(item => item.textContent)).toEqual(['Review Test', 'Second Test', 'Third Test', 'Fourth Test']);
    fireEvent.click(within(queue).getByRole('button', { name: 'Review Second Test' }));
    queue = within(document.body).getByRole('region', { name: /needs review/i });
    expect(within(queue).getByRole('button', { name: 'Review page 2' })).toBeTruthy();
    expect(queue.querySelectorAll('.review-group-body:not([hidden])')).toHaveLength(1);
  });

  test('refuses to close a candidate whose URL or protected state changed', async () => {
    vi.useFakeTimers({ now: reviewNow });
    const { document, chrome, setTabs } = await loadDashboard({ tabs: [staleTab(1)] });
    expandReview(document);
    setTabs([staleTab(1, { url: 'https://review.test/unsaved-work' })]);
    await actOnReview(document, 1, 'Close');
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
    expect(within(document.body).getByRole('alert').textContent).toMatch(/navigated elsewhere/);
    setTabs([staleTab(1, { audible: true })]);
    await actOnReview(document, 1, 'Save & close');
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('prevents double clicks while closing and returns keyboard focus to the group when complete', async () => {
    vi.useFakeTimers({ now: reviewNow });
    const { document, chrome } = await loadDashboard({ tabs: [staleTab(1)] });
    expandReview(document);
    let finishClose;
    const remove = chrome.tabs.remove.getMockImplementation();
    chrome.tabs.remove.mockImplementationOnce(id => new Promise(resolve => { finishClose = async () => { await remove(id); resolve(); }; }));
    const close = document.querySelector('[data-action="review-close"]');
    close.focus();
    fireEvent.click(close);
    await flushAsyncWork();
    fireEvent.click(document.querySelector('[data-action="review-close"]'));
    expect(chrome.tabs.remove).toHaveBeenCalledTimes(1);
    await finishClose();
    await flushAsyncWork();
    expect(document.getElementById('openTabsSection').style.display).toBe('block');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Collapse Review Test');
    expect(within(document.body).getByText('All reviewed for now')).toBeTruthy();
  });
});
