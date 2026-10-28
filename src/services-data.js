// Shared service definitions — included by background.js (importScripts),
// options.js, and popup.js via <script> tags.

// Brand icons from https://about.google/brand-resource-center/logos-list/
function _icon(file) {
  return `<img src="icons/${file}" width="32" height="32" alt="">`;
}

const SERVICE_DEFS = {
  'mail.google.com':           { label: 'Gmail',        icon: _icon('gmail.webp')        },
  'chat.google.com':           { label: 'Chat',         icon: _icon('chat.webp')         },
  'meet.google.com':           { label: 'Meet',         icon: _icon('meet.webp')         },
  'calendar.google.com':       { label: 'Calendar',     icon: _icon('calendar.webp')     },
  'drive.google.com':          { label: 'Drive',        icon: _icon('drive.webp')        },
  'docs.google.com':           { label: 'Docs',         icon: _icon('docs.webp')         },
  'sheets.google.com':         { label: 'Sheets',       icon: _icon('sheets.webp')       },
  'slides.google.com':         { label: 'Slides',       icon: _icon('slides.webp')       },
  'forms.google.com':          { label: 'Forms',        icon: _icon('forms.webp')        },
  'keep.google.com':           { label: 'Keep',         icon: _icon('keep.webp')         },
  'tasks.google.com':          { label: 'Tasks',        icon: _icon('tasks.webp')        },
  'contacts.google.com':       { label: 'Contacts',     icon: _icon('contacts.png')      },
  'classroom.google.com':      { label: 'Classroom',    icon: _icon('classroom.svg')     },
  'sites.google.com':          { label: 'Sites',        icon: _icon('sites.webp')        },
  'groups.google.com':         { label: 'Groups',       icon: _icon('groups.png')        },
  'photos.google.com':         { label: 'Photos',       icon: _icon('photos.webp')       },
  'voice.google.com':          { label: 'Voice',        icon: _icon('voice.webp')        },
  'play.google.com':           { label: 'Play',         icon: _icon('play.webp')         },
  'one.google.com':            { label: 'One',          icon: _icon('one.webp')          },
  'admin.google.com':          { label: 'Admin',        icon: _icon('admin.webp')        },
  'analytics.google.com':      { label: 'Analytics',    icon: _icon('analytics.svg')     },
  'ads.google.com':            { label: 'Ads',          icon: _icon('ads.webp')          },
  'lookerstudio.google.com':   { label: 'Looker Studio',icon: _icon('lookerstudio.webp') },
  'colab.research.google.com': { label: 'Colab',        icon: _icon('colab.svg')         },
  'search.google.com':         { label: 'Search Console', icon: _icon('searchconsole.webp') },
  'tagmanager.google.com':     { label: 'Tag Manager',  icon: _icon('tagmanager.webp')   },
  'merchants.google.com':      { label: 'Merchant Center', icon: _icon('merchants.webp') },
  'business.google.com':       { label: 'Business Profile', icon: _icon('business.webp') },
  'adsense.google.com':        { label: 'AdSense',      icon: _icon('adsense.webp')      },
  'console.cloud.google.com':  { label: 'Cloud Console',icon: _icon('cloud.webp')        },
  'console.firebase.google.com': { label: 'Firebase',   icon: _icon('firebase.webp')     },
  'maps.google.com':           { label: 'Maps',         icon: _icon('maps.webp')         },
  'gemini.google.com':         { label: 'Gemini',       icon: _icon('gemini.svg')        },
  'notebooklm.google.com':     { label: 'NotebookLM',   icon: _icon('notebooklm.webp')   },
  'myaccount.google.com':      { label: 'My Account',   icon: _icon('google.webp')       },
};

// Default groups, after Google Workspace's Connect / Create / Access / Control
const SERVICE_GROUPS = [
  {
    id: 'connect',
    label: 'Connect',
    hosts: [
      'mail.google.com', 'chat.google.com', 'meet.google.com', 'calendar.google.com',
      'contacts.google.com', 'groups.google.com', 'voice.google.com',
    ],
  },
  {
    id: 'create',
    label: 'Create',
    hosts: [
      'docs.google.com', 'sheets.google.com', 'slides.google.com', 'forms.google.com',
      'sites.google.com', 'keep.google.com', 'tasks.google.com',
    ],
  },
  {
    id: 'access',
    label: 'Access',
    hosts: ['drive.google.com', 'photos.google.com', 'one.google.com'],
  },
  {
    id: 'ai',
    label: 'AI',
    hosts: ['gemini.google.com', 'notebooklm.google.com'],
  },
  {
    id: 'everyday',
    label: 'Everyday',
    hosts: ['maps.google.com', 'play.google.com', 'classroom.google.com'],
  },
  {
    id: 'marketing-business',
    label: 'Marketing & Business',
    hosts: [
      'analytics.google.com', 'ads.google.com', 'tagmanager.google.com', 'search.google.com',
      'lookerstudio.google.com', 'merchants.google.com', 'business.google.com', 'adsense.google.com',
    ],
  },
  {
    id: 'developer',
    label: 'Developer',
    hosts: ['console.cloud.google.com', 'console.firebase.google.com', 'colab.research.google.com'],
  },
  {
    id: 'control',
    label: 'Control',
    hosts: ['myaccount.google.com', 'admin.google.com'],
  },
];

// Ensure every host in SERVICE_DEFS is covered by some group; any uncovered hosts (services added
// since the groups were saved) are appended to the last group.
function reconcileGroups(groups) {
  const covered = new Set(groups.flatMap(g => g.hosts));
  const uncovered = Object.keys(SERVICE_DEFS).filter(h => !covered.has(h));
  if (uncovered.length > 0) groups[groups.length - 1].hosts.push(...uncovered);
  return groups;
}

// Account index or email named by a URL's /u/N/ path or authuser= param, or null
function accountFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/u\/(\d+)(\/|$)/);
    return m ? m[1] : u.searchParams.get('authuser');
  } catch {
    return null;
  }
}

// Services whose account-specific URL uses a /u/N/ path or a page other than the root; the rest get ?authuser=N
const ACCOUNT_URLS = {
  'mail.google.com':      n => `https://mail.google.com/mail/u/${n}/`,
  'calendar.google.com':  n => `https://calendar.google.com/calendar/u/${n}/r`,
  'drive.google.com':     n => `https://drive.google.com/drive/u/${n}/my-drive`,
  'docs.google.com':      n => `https://docs.google.com/document/u/${n}/`,
  'sheets.google.com':    n => `https://docs.google.com/spreadsheets/u/${n}/`,
  'slides.google.com':    n => `https://docs.google.com/presentation/u/${n}/`,
  'forms.google.com':     n => `https://docs.google.com/forms/u/${n}/`,
  'keep.google.com':      n => `https://keep.google.com/u/${n}/`,
  'photos.google.com':    n => `https://photos.google.com/u/${n}/`,
  'myaccount.google.com': n => `https://myaccount.google.com/u/${n}/`,
  'search.google.com':    n => `https://search.google.com/search-console?authuser=${n}`,
};

function accountServiceUrl(host, n) {
  return ACCOUNT_URLS[host] ? ACCOUNT_URLS[host](n) : `https://${host}/?authuser=${n}`;
}

// Options → Gmail, with their defaults
const GMAIL_DEFAULTS = {
  expandUnread: 'always',  // where accounts list unread mail right away: 'never', 'dashboard', 'popup' or 'always'
  mailListCount: 'all',    // emails listed per account: '3', '5', '10' or 'all' (the feed has at most 20)
  mailSnippetLines: 3,     // lines of each email's text in lists, 0–3
  mailAvatars: true,       // sender avatars in lists and threads
  mailListHeader: true,    // "Inbox" and Open Gmail above lists in account cards
  mailClick: 'preview',    // clicking an email: 'preview' (in its list) or 'gmail'
  threadOpen: 'last',      // messages open when a thread shows: 'last' or 'all'
  mailCheckMinutes: 2,     // how often unread mail is checked
  toolbarBadge: 'all',     // toolbar icon count: 'off', 'all', or one account's accountKey
};

// Options → Open tabs and Options → Recent files
const PANEL_DEFAULTS = {
  tabsScope: 'all',        // tabs listed: 'all' or only 'google' services
  tabsGroupBy: 'window',   // tabs listed under each 'window' or 'account', or in one list ('none')
  tabsClose: true,         // × on each tab row closes the tab
  tabsGroupColors: true,   // a strip in the color of the tab's Chrome tab group
  recentPerAccount: 5,     // files listed per group, or in all when not grouped
  recentGroupBy: 'account', // files listed under each 'account' or 'type', or in one list ('none')
  recentDocs: true,        // file types listed
  recentSheets: true,
  recentSlides: true,
  recentForms: true,
  recentDays: 30,          // files opened in the last 1, 7, 30 or 90 days
  recentSort: 'recent',    // 'recent' (last opened first) or 'visits' (most visited first)
};

// Dashboard sections in default order; width is a share of the page row
const DASHBOARD_SECTIONS = [
  // Chrome-style bookmarks bar; dashboard only, there's no room for its menus in the popup
  { id: 'bookmarks', label: 'Bookmarks',   visible: true, width: 'full', popup: false },
  { id: 'search',   label: 'Search',       visible: true, width: 'full'  },
  { id: 'accounts', label: 'Accounts',     visible: true, width: 'full'  },
  { id: 'tabs',     label: 'Open tabs',    visible: true, width: 'third' },
  { id: 'recent',   label: 'Recent files', visible: true, width: 'third' },
  { id: 'stats',    label: 'Statistics',   visible: true, width: 'third' },
];

// Toolbar popup layout: the launcher plus any dashboard sections, in saved order
function popupOrder(saved) {
  const ids = ['launcher', ...DASHBOARD_SECTIONS.filter(d => d.popup !== false).map(d => d.id)];
  const known = (saved || []).filter(id => ids.includes(id));
  return [...known, ...ids.filter(id => !known.includes(id))];
}

// Line icons for dashboard sections, shown on the dashboard and in Options
const SECTION_ICON_PATHS = {
  launcher: [5, 12, 19].flatMap(y => [5, 12, 19].map(x => `<circle cx="${x}" cy="${y}" r="1"/>`)).join(''),
  search:   '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  accounts: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  tabs:     '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="4" x2="9" y2="9"/>',
  bookmarks: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  recent:   '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  stats:    '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
};

function sectionIcon(id, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SECTION_ICON_PATHS[id]}</svg>`;
}

// Saved section settings ({ id, visible, width, title }[]) in saved order, plus any sections added since
function dashboardSections(saved) {
  const known = (saved || []).filter(s => DASHBOARD_SECTIONS.some(d => d.id === s.id));
  const missing = DASHBOARD_SECTIONS.filter(d => !known.some(s => s.id === d.id));
  return [...known, ...missing].map(s => {
    const def = DASHBOARD_SECTIONS.find(d => d.id === s.id);
    return { id: s.id, label: def.label, visible: s.visible ?? def.visible, width: s.width ?? def.width, title: s.title ?? true };
  });
}

// Stable key for per-account settings (nickname, order): email when known, else #index
const accountKey = (a) => a.email || `#${a.index}`;

// Accounts sorted by the saved key order; accounts not in it keep their place after the rest
function orderAccounts(accounts, order) {
  const rank = (a) => {
    const i = (order || []).indexOf(accountKey(a));
    return i === -1 ? Infinity : i;
  };
  return [...accounts].sort((a, b) => rank(a) - rank(b));
}

// Dashboard title: 'auto' (date and time in the browser's locale), 'text:…' (static text), or a
// format string with tokens dddd ddd D DD MMMM MMM M MM YYYY YY H HH h hh mm ss A; [text] is printed as is
const TITLE_FORMATS = ['auto', 'dddd D MMMM · HH:mm', 'ddd D MMM YYYY · HH:mm', 'dddd D MMMM', 'HH:mm:ss'];

function formatDate(date, format) {
  if (format.startsWith('text:')) return format.slice(5);
  if (format === 'auto') {
    const day = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    return `${day} · ${time}`;
  }
  const name = (options) => date.toLocaleDateString(undefined, options);
  const pad = (n) => String(n).padStart(2, '0');
  const h12 = date.getHours() % 12 || 12;
  const tokens = {
    dddd: () => name({ weekday: 'long' }),  ddd: () => name({ weekday: 'short' }),
    MMMM: () => name({ month: 'long' }),    MMM: () => name({ month: 'short' }),
    MM:   () => pad(date.getMonth() + 1),   M:   () => date.getMonth() + 1,
    YYYY: () => date.getFullYear(),         YY:  () => pad(date.getFullYear() % 100),
    DD:   () => pad(date.getDate()),        D:   () => date.getDate(),
    HH:   () => pad(date.getHours()),       H:   () => date.getHours(),
    hh:   () => pad(h12),                   h:   () => h12,
    mm:   () => pad(date.getMinutes()),     ss:  () => pad(date.getSeconds()),
    A:    () => (date.getHours() < 12 ? 'AM' : 'PM'),
  };
  return format.replace(/\[([^\]]*)\]|dddd|ddd|D{1,2}|M{1,4}|YYYY|YY|HH?|hh?|mm|ss|A/g,
    (match, literal) => literal ?? tokens[match]());
}
