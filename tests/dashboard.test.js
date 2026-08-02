import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { URL } from 'node:url';

const indexPath = new URL('../extension/index.html', import.meta.url);
const appPath = new URL('../extension/app.js', import.meta.url);
const extensionUrl = 'chrome-extension://tab-out-test/index.html';
const gib = 1024 ** 3;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flushAsyncWork() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
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

  let tabs = initialTabs.map(item => ({ ...item }));
  const storage = { deferred };
  const chrome = {
    runtime: { id: 'tab-out-test' },
    tabs: {
      query: vi.fn(async () => tabs.map(item => ({ ...item }))),
      discard: vi.fn(async () => {}),
      remove: vi.fn(async tabIds => {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        tabs = tabs.filter(item => !ids.includes(item.id));
      }),
      update: vi.fn(async () => {}),
    },
    windows: {
      getCurrent: vi.fn(async () => ({ id: 1 })),
      update: vi.fn(async () => {}),
    },
    storage: {
      local: {
        get: vi.fn(async key => ({ [key]: storage[key] || [] })),
        set: vi.fn(async patch => Object.assign(storage, patch)),
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
    chrome,
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

    fireEvent.click(collapseButton);

    expect(within(page.getByRole('region', { name: /needs review/i })).queryByText('Figma')).toBeNull();
  });

  test('reviews and snoozes only the stale tabs shown for a domain', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-05T12:00:00Z') });
    const { chrome, document } = await loadDashboard({
      tabs: [
        tab({ id: 1, url: 'https://www.figma.com/file/old-design', title: 'Old design', lastAccessed: new Date('2026-06-26T12:00:00Z').getTime() }),
        tab({ id: 2, url: 'https://www.figma.com/file/current-design', title: 'Current design', active: true, lastAccessed: new Date('2026-07-05T11:00:00Z').getTime() }),
        tab({ id: 3, url: 'https://www.figma.com/file/old-flow', title: 'Old flow', lastAccessed: new Date('2026-06-27T12:00:00Z').getTime() }),
      ],
    });
    const page = within(document.body);
    const collapsedQueue = page.getByRole('region', { name: /needs review/i });
    fireEvent.click(within(collapsedQueue).getByRole('button', { name: /show/i }));
    const reviewQueue = page.getByRole('region', { name: /needs review/i });

    fireEvent.click(within(reviewQueue).getByRole('button', { name: /review figma/i }));
    await flushAsyncWork();

    const figmaCard = document.querySelector('[data-domain-id="domain-www-figma-com"]');
    expect(figmaCard.classList.contains('is-reviewing')).toBe(true);
    expect(figmaCard.querySelector('[data-tab-id="1"]').classList.contains('is-review-candidate')).toBe(true);
    expect(figmaCard.querySelector('[data-tab-id="3"]').classList.contains('is-review-candidate')).toBe(true);
    expect(figmaCard.querySelector('[data-tab-id="2"]').classList.contains('is-review-candidate')).toBe(false);

    const refreshedQueue = page.getByRole('region', { name: /needs review/i });
    const snoozeButton = within(refreshedQueue).getByRole('button', { name: /snooze figma for 30 days/i });
    expect(snoozeButton.textContent).toMatch(/Snooze 30 days/);
    fireEvent.click(snoozeButton);
    await flushAsyncWork();

    expect(page.queryByRole('region', { name: /needs review/i })).toBeNull();
    const [[{ reviewSnoozesByUrl }]] = chrome.storage.local.set.mock.calls.slice(-1);
    expect(Object.keys(reviewSnoozesByUrl).sort()).toEqual([
      'https://www.figma.com/file/old-design',
      'https://www.figma.com/file/old-flow',
    ].sort());
  });

  test('shows at most three review groups ordered by their oldest stale tab', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-05T12:00:00Z') });
    const daysAgo = (days) => new Date('2026-07-05T12:00:00Z').getTime() - days * 24 * 60 * 60 * 1000;
    const { document } = await loadDashboard({
      tabs: [
        tab({ id: 1, url: 'https://one.test/old', title: 'One', lastAccessed: daysAgo(8) }),
        tab({ id: 2, url: 'https://two.test/old', title: 'Two', lastAccessed: daysAgo(9) }),
        tab({ id: 3, url: 'https://three.test/old', title: 'Three', lastAccessed: daysAgo(10) }),
        tab({ id: 4, url: 'https://four.test/old', title: 'Four', lastAccessed: daysAgo(11) }),
      ],
    });
    const page = within(document.body);
    const collapsedQueue = page.getByRole('region', { name: /needs review/i });
    fireEvent.click(within(collapsedQueue).getByRole('button', { name: /show/i }));
    const reviewQueue = page.getByRole('region', { name: /needs review/i });
    const labels = [...reviewQueue.querySelectorAll('.needs-review-copy strong')].map(item => item.textContent);

    expect(labels).toEqual(['Four Test', 'Three Test', 'Two Test']);
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
