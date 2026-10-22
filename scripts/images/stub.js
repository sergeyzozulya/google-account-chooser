// Minimal chrome.* API so extension pages render outside the extension, filled with
// fictional data for screenshots. No real accounts, emails, tabs or files appear here.
(() => {
  const noop = () => {};
  const event = { addListener: noop, removeListener: noop };
  const min = 60 * 1000;
  const now = Date.now();

  const accounts = [
    { index: 0, email: 'alex.rivera@gmail.com', name: 'Alex Rivera' },
    { index: 1, email: 'alex@northwind.example', name: 'Alex Rivera' },
    { index: 2, email: 'a.rivera@contoso.example', name: 'Alex Rivera' },
  ];
  const unread = { 0: 4, 1: 23, 2: 0 };

  // Newest unread emails per account, as Gmail's Atom feed lists them: [sender, subject, text, minutes ago]
  const emails = {
    0: [
      ['Maria Santos', 'Lisbon in May?', 'Found a flat near Alfama for the second week — sending the link so you can have a look before it goes.', 25],
      ['Book Club', 'Next pick: The Overstory', 'We meet on the 3rd at Sam’s. Bring snacks and your favourite passage to read aloud.', 190],
      ['Home Insurance', 'Your renewal documents', 'Your policy renews on 1 November. Review the attached documents and let us know of any changes.', 1500],
    ],
    1: [
      ['Priya Nair', 'Q4 budget — final numbers', 'Updated the forecast tab with the October actuals. Can you sign off before Thursday’s review?', 8],
      ['Jordan Lee', 'Roadmap review moved to 3pm', 'Clashes with the board prep, so pushed it an hour. Same room, agenda unchanged.', 47],
      ['Northwind IT', 'Scheduled maintenance this weekend', 'VPN and the wiki will be unavailable on Saturday from 22:00 to 02:00.', 320],
    ],
  };
  const feed = (slot) => `<feed><title>Gmail - Inbox for ${accounts[slot]?.email}</title><fullcount>${unread[slot] ?? 0}</fullcount>${
    (emails[slot] || []).map(([from, subject, text, ago], i) => `<entry><title>${subject}</title><summary>${text}</summary>`
      + `<link href="https://mail.google.com/mail?account_id=x&amp;message_id=18f${slot}${i}a&amp;view=conv"/>`
      + `<issued>${new Date(now - ago * min).toISOString()}</issued><author><name>${from}</name></author></entry>`).join('')}</feed>`;

  const stored = {
    sync: {
      mailListCount: '3',
      accountLabels: {
        'alex.rivera@gmail.com': 'Personal',
        'alex@northwind.example': 'Northwind',
        'a.rivera@contoso.example': 'Contoso',
      },
    },
    local: {
      accountsCache: { accounts, unread },
      stats: {
        services: { 'mail.google.com': 64, 'calendar.google.com': 31, 'drive.google.com': 27, 'docs.google.com': 18, 'meet.google.com': 9 },
        accounts: { 0: 58, 1: 71, 2: 20 },
      },
    },
  };

  // Popup layouts for the popup screenshot, chosen with ?view= on popup.html (and seen by its dashboard frames)
  const POPUP_VIEWS = {
    accounts: { showMenuServices: false, popupSections: { accounts: true }, popupOrder: ['accounts'] },
    // Mail lists folded, so the per-account launcher fits
    launcher: { showMenuServices: false, popupSections: { accounts: true }, popupOrder: ['accounts'], expandUnread: 'dashboard' },
    sections: { showMenuServices: false, popupSections: { search: true, accounts: true, tabs: true }, popupOrder: ['search', 'accounts', 'tabs'] },
  };
  Object.assign(stored.sync, POPUP_VIEWS[new URLSearchParams((window.parent || window).location.search).get('view')]);

  const tabs = [
    { id: 1, windowId: 1, url: 'https://mail.google.com/mail/u/1/#inbox', title: 'Inbox (23) - alex@northwind.example - Northwind Mail' },
    { id: 2, windowId: 1, url: 'https://calendar.google.com/calendar/u/1/r/week', title: 'Northwind - Calendar - Week of 12 October' },
    { id: 3, windowId: 1, url: 'https://docs.google.com/spreadsheets/u/1/d/q4budget/edit', title: 'Q4 budget - Google Sheets' },
    { id: 4, windowId: 1, url: 'https://mail.google.com/mail/u/0/#inbox', title: 'Inbox (4) - alex.rivera@gmail.com - Gmail' },
    { id: 5, windowId: 1, url: 'https://photos.google.com/u/0/', title: 'Photos - Google Photos' },
  ];

  const history = [
    ['document/u/1/d/roadmap', 'Product roadmap 2027 - Google Docs', 12],
    ['spreadsheets/u/1/d/q4budget', 'Q4 budget - Google Sheets', 40],
    ['presentation/u/1/d/allhands', 'All-hands October - Google Slides', 180],
    ['document/u/0/d/trip', 'Lisbon trip plan - Google Docs', 95],
    ['spreadsheets/u/0/d/home', 'Home renovation costs - Google Sheets', 1500],
    ['forms/u/2/d/survey', 'Customer survey - Google Forms', 300],
    ['document/u/2/d/proposal', 'Partnership proposal - Google Docs', 2900],
  ].map(([path, title, ago]) => ({ url: `https://docs.google.com/${path}/edit`, title, lastVisitTime: now - ago * min }));

  // Bookmarks bar and Other bookmarks, ids assigned below
  let nextId = 10;
  const withIds = (node) => ({ ...node, id: String(nextId++), children: node.children?.map(withIds) });
  const bookmarkRoot = withIds({ title: '', children: [
    { title: 'Bookmarks bar', folderType: 'bookmarks-bar', children: [
      { title: 'Northwind', children: [
        { title: 'Q4 budget', url: 'https://docs.google.com/spreadsheets/u/1/d/q4budget/edit' },
        { title: 'Sales dashboard', url: 'https://lookerstudio.google.com/?authuser=1' },
        { title: 'Customer portal', url: 'https://portal.contoso.example/' },
        { title: 'Projects', children: [
          { title: 'Product roadmap 2027', url: 'https://docs.google.com/document/u/1/d/roadmap/edit' },
          { title: 'Archive', children: [
            { title: 'All-hands October', url: 'https://docs.google.com/presentation/u/1/d/allhands/edit' },
          ] },
        ] },
      ] },
      { title: 'Personal', children: [
        { title: 'Lisbon trip plan', url: 'https://docs.google.com/document/u/0/d/trip/edit' },
        { title: 'Family photos', url: 'https://photos.google.com/u/0/' },
      ] },
      { title: 'Tools', children: [] },
      { title: 'Team wiki', url: 'https://wiki.northwind.example/' },
      { title: 'Northwind calendar', url: 'https://calendar.google.com/calendar/u/1/r' },
      { title: 'Recipes', url: 'https://recipes.example/' },
    ] },
    { title: 'Other bookmarks', folderType: 'other', children: [
      { title: 'Reading list', url: 'https://reading.example/' },
    ] },
  ] });

  // Accepts the forms chrome.storage.get does: a key, a list of keys, or { key: default }
  const area = (name) => ({
    get(keys, cb) {
      const data = {};
      if (typeof keys === 'string') keys = [keys];
      if (Array.isArray(keys)) for (const k of keys) { if (k in stored[name]) data[k] = stored[name][k]; }
      else Object.assign(data, structuredClone(keys || {}), ...Object.keys(keys || {}).filter(k => k in stored[name]).map(k => ({ [k]: stored[name][k] })));
      if (cb) setTimeout(() => cb(data));
      return Promise.resolve(data);
    },
    set: (_d, cb) => { if (cb) cb(); return Promise.resolve(); },
  });

  window.chrome = {
    storage: { sync: area('sync'), local: area('local'), onChanged: event },
    // The dashboard reads Gmail feeds through the background worker
    runtime: {
      openOptionsPage: noop,
      getURL: (p) => p,
      sendMessage: (msg) => Promise.resolve(msg?.type === 'feed' && msg.n in unread ? { status: 200, text: feed(msg.n) } : undefined),
    },
    tabs: { create: () => Promise.resolve(), update: noop, query: () => Promise.resolve(tabs), onCreated: event, onRemoved: event, onUpdated: event },
    windows: { update: noop },
    permissions: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true), remove: () => Promise.resolve() },
    history: { search: () => Promise.resolve(history) },
    bookmarks: {
      getTree: () => Promise.resolve([bookmarkRoot]),
      onCreated: event, onRemoved: event, onChanged: event, onMoved: event, onChildrenReordered: event,
    },
  };

  // Google's account list "fails", so the dashboard keeps the accounts above
  window.fetch = async () => ({ ok: false, text: async () => '' });
})();
