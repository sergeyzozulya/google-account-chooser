# Changelog

## [2.3.1] — 2026-10-31

### Added
- **Toolbar icon** (Options → General): the default icon, a live icon that shows the date or time (Day, Weekday, Mini date, Clock), or another picture (Launcher, Panels)
- **Icon** (Options → Dashboard): the same choices, separately, for the icon in the header of the dashboard and the popup and on the dashboard's browser tab
- **Account** (Options → Open tabs, Options → Recent files): show or hide the account's avatar on each row
- **Date and time** (Options → Recent files): Off, Time ago (the default), Time or date (the time today, otherwise the date), Date, or Date and time

---

## [2.2.0] — 2026-10-28

### Added
- **Options → Open tabs**: list all tabs (the default) or only Google service tabs, Grouping (by window, the default, with installed web apps under their own name; by account, with other sites under Other tabs; or none), Close buttons (× on a tab's row), and Tab groups (a strip in the color of the tab's Chrome tab group)
- **Options → Recent files**: Files listed (per account or type; replaces Options → Dashboard → Recent files per account), Grouping (by account, the default; by type; or none), File types (Docs, Sheets, Slides, Forms), Period (1, 7, 30 or 90 days) and Sort (last opened or most visited)
- **Layout** (Options → Popup): dashboard sections in the popup all expanded (default) or as an accordion, one open at a time (the first when the popup opens), the others folded to their title
- **Placement** (Top or Center) and **Size** (Full width, or at most 1600, 1200 or 960 px wide) (Options → Dashboard)
- **Section height** (Options → Dashboard): how tall Open tabs, Recent files and Statistics grow before they scroll, Auto or 240 to 600 px (default 420)
- **New tabs open** (Options → Dashboard): next to the dashboard (default) or at the end of the window
- Services: Tasks, NotebookLM, Search Console, Tag Manager, Merchant Center, Business Profile, AdSense, Cloud Console, Firebase
- Permission (no install warning): `tabGroups`, for Tab groups

### Changed
- Default service groups follow Google Workspace's Connect / Create / Access / Control: Connect, Create, Access, AI, Everyday, Marketing & Business, Developer, Control (saved groups are kept; new services join the last one)
- Host permissions narrowed to `accounts.google.com` and `mail.google.com`, the only sites the extension reads from; routing links through Account Chooser doesn't need them
- Arrow keys move through the whole popup, always: the header buttons, the launcher and every dashboard section (search, accounts, tabs, files, accordion titles; not Clear and Reset); the Keyboard navigation setting is gone
- Options are split into tabs: General (General, Accounts), Interface (Dashboard, Popup, Search, Gmail, Open tabs, Recent files, Launcher) and Services (Services, Window)
- Accounts (order, nicknames, switches) have their own card under General
- Recent files whose links never named an account are listed under the default (first) account instead of Account not known; opening them still goes through Account Chooser
- The toolbar badge skips its mail check while an open dashboard or popup has just checked
- The dashboard refreshes accounts, mail, open tabs and recent files when its tab is selected or its window focused
- Search is a panel with an optional Search title (Options → Dashboard → Sections → Title); in the popup's accordion it folds like the other sections; its search buttons moved from Options → Dashboard to their own Options → Search card; with no search buttons it stays, and Enter searches Google
- Accounts share one panel, divided by lines, with an optional Accounts title (Options → Dashboard → Sections → Title); they sit in one row when the section is full width and in one column otherwise, and the Accounts per row setting is gone
- Bookmarks narrower than full width show as a list whose folders open in place
- With accounts in a column (section narrower than full width), an account's launcher expands inside its card instead of floating
- Options → Popup → Show in popup is now **Sections**, at the top of the card
- Sections in the popup and side panel show in full, the popup scrolling as a whole, instead of each scrolling at a fixed height
- Keyboard focus shows as a hover background, like in the launcher, on the dashboard and in the popup

### Fixed
- The launcher left out services added since the service groups were last saved
- One account could show as two groups in Open tabs and Recent files when Google named it by number in some links and by email in others
- Gmail feeds were fetched twice when the popup's sections and the toolbar badge checked at the same time

---

## [2.1.0] — 2026-10-22

### Added
- **Unread mail** on the dashboard and in the popup and side panel: each account's unread inbox emails (up to 20, from Gmail's feed) with sender, date, subject and text, like the Gmail app; listed right away in the account card, or in a panel from the Gmail unread badge
- **Email preview**: clicking an email shows its thread in the list, earlier messages folded like in Gmail; Back returns to the list, Open in Gmail opens it in Gmail
- **Options → Gmail**: Expand unread emails (Never, Dashboard, Popup, Always), Emails listed, Text lines, Sender avatars, List header, Clicking an email, Thread messages, Check mail every, Toolbar icon count (off, all accounts or one account)
- **Width** (Options → Popup): Auto, or 320 to 800 px
- A switch for each account in Options → Dashboard → Accounts: a switched-off account has no card on the dashboard or in the popup, isn't offered in search, and its mail isn't checked or counted; open tabs, recent files and statistics still list it

### Changed
- An account signed out of Gmail shows a grey Gmail icon with an amber "!" instead of none; clicking it opens Gmail to sign in again. Chrome no longer asks for a Gmail username and password
- With no unread mail, the Gmail badge opens Gmail
- Opening an email switches to a Gmail tab or web app window already open on that account and shows the email there

---

## [2.0.2] — 2026-10-20

### Changed
- Dashboard and popup links that open a new tab now open in the service's installed web app (e.g. Gmail) when there is one
- A service opened from an account's launcher, or that account's Gmail unread badge, switches to a tab or web app window already open on that service and account instead of opening another; Ctrl/⌘-click still opens a new one
- The Accounts section has no title (and no Title switch in Options → Dashboard → Sections); its hint and account count stepper show only while detecting or when detection fails

---

## [2.0.1] — 2026-10-20

### Added
- **Open links** (Options → Dashboard): dashboard links (services, recent files, bookmarks, searches) open in a new tab (default), the current tab, or a new tab only when the dashboard tab is pinned; Ctrl/⌘-click always opens a new tab, and the popup always opens one

### Changed
- Dashboard bookmarks follow **Open links** instead of always opening in the same tab

---

## [2.0.0] — 2026-10-18

### Added
- **Dashboard** page (popup header button, or icon in the Options header): one card per signed-in account with photo, email or nickname, Gmail unread count, and a launcher that opens services directly in that account
- Dashboard **bookmarks bar** modelled on Chrome's: bar items, nested folder menus, » overflow and Other bookmarks; opens in the same tab (Ctrl/⌘-click for a new tab); dashboard only
- Dashboard **search**: Google (default on Enter), plus Gmail and Drive split buttons that search a chosen account
- Dashboard **Open tabs** and **Recent files** (Docs, Sheets, Slides, Forms from browser history), grouped by account, with a Clear button for recent files
- Dashboard **Statistics**: launches per service and account
- **Turn on** buttons for Recent files and Bookmarks request the optional `history`, `bookmarks` and `favicon` permissions only when used
- Accounts detected from the Google session (Gmail feeds as fallback, manual count as last resort), cached locally and refreshed in the background
- **Unread badge** on the toolbar icon: total Gmail unread across accounts, refreshed every 2 minutes and whenever the dashboard refreshes
- Options → Dashboard: account order, nicknames and accounts per row; section order, width, visibility and title; header title (date-and-time presets, static text or a custom format); search buttons; recent files per account
- **Show in popup** (Options → Popup): the launcher and any dashboard section (except Bookmarks) in the popup, in any order
- **Dashboard in new tabs** (Options → General): new tabs open the dashboard, with an editable tab title (default "New tab")
- **Toolbar icon opens** (Options → General): the popup (default) or the same content in Chrome's side panel, which stays open
- Options page title and section titles stay visible while scrolling
- **What's new** page with screenshots and this changelog, opened once after each update and from the ? icon in the Options header
- `scripts/build-images.mjs` regenerates icons, screenshots and store images (with fictional data) from `images/icon.svg` and the extension pages
- Permissions (no install warnings): `alarms`, `sidePanel`, and `declarativeNetRequestWithHostAccess` to remove the extension's Origin header from Google's account-list request

### Changed
- Renamed to **Google Account Chooser (and Dashboard)**; new icon
- The popup title shows the dashboard title (date and time by default)
- Options renamed to match Chrome's terms: **Menu** is now **Popup** (the toolbar popup), the **Popup** section is now **Window** (separate service windows), and in the services table **Popup** is now **Window** and **Menu** is now **Launcher**; **Enable extension** is now **Intercept Google links**
- Launcher options (service groups, names below icons, keyboard navigation) moved to their own **Launcher** section and always apply, since the launcher also appears on the dashboard
- Minimum Chrome version raised from 109 to 114 (side panel)

---

## [1.3.0] — 2026-04-16

### Added
- **Keyboard navigation** in popup: use arrow keys to navigate between services, Home/End to jump to first/last; first service is focused on popup open
- **Keyboard navigation toggle** in Options → Menu: enable/disable the keyboard navigation feature (enabled by default)

---

## [1.2.0] — 2026-04-11

### Added
- Left border separators in Options table: Intercept and Menu columns now have visual separators

### Changed
- **Column reordering** in Options: Skip column moved before Menu column
- **Intercept off behavior**: when a service's Intercept is unchecked, the Popup and Skip checkboxes are now hidden (previously they were only dimmed)
- **Group Intercept off**: when a group's Intercept is unchecked, both the group's and its services' Popup/Skip checkboxes are hidden
- **Independent Menu toggle**: toggling service or group Intercept checkbox no longer affects the Menu checkbox — Menu stays independent

---

## [1.1.1] — 2026-03-13

### Changed
- `host_permissions` narrowed from `*://*.google.com/*` to explicit per-service hostnames — extension now declares exactly the 27 subdomains it accesses rather than all of `*.google.com`
- `minimum_chrome_version` set to `109` (MV3 service workers)
- Extension icons now ship as separate correctly-sized PNGs (16 × 16, 32 × 32, 48 × 48, 128 × 128) instead of a single 128 px file for all sizes

---

## [1.1] — 2026-03-12

### Added
- **Gemini** (`gemini.google.com`) added to the Personal service group
- **Group management** in Options: add, rename, and delete groups; always keeps at least one group
- **Drag-and-drop** reordering for both groups and services; services can be moved between groups
- **Show service groups** toggle in Options → Menu: controls whether group separators appear in the popup icon grid
- **Show names below icons** toggle in Options → Menu: show/hide service name labels in the popup
- **Show title** toggle in Options → Menu: show/hide the "Google Account Chooser" heading in the popup
- Settings gear icon in popup header; shown/hidden together with the title
- **Window placement** setting: Center, Tiles (cascading), or Custom (remembers last position per service)
- **Window size** setting: Default (1024×768), Large (75% of current window), Full screen, or Custom (remembers last size per service); defaults to Custom
- Per-service **Skip** toggle: skip Account Chooser when a URL already specifies a user account (`authuser=` or `/u/N/`)
- Column-level group switches: toggle Intercept / Popup / Menu / Skip for all services in a group at once; shows indeterminate state when mixed
- New services default to Menu and Skip enabled

### Changed
- Services table converted to a proper `<thead>` with centered column headers; header row is sticky on scroll
- Group name casing is now freeform (no forced uppercase)
- Group header font size matches service rows
- Popup icon grid uses `repeat(auto-fill, minmax(52px, 1fr))` layout
- Group labels in the popup are left-aligned with a trailing separator line
- On first install (or after extension reinstall), default settings are applied immediately — popup shows services without requiring the Options page to be opened first
- Options page correctly persists defaults for any newly added service (e.g. after an extension update) without overwriting existing saved values
- Groups are identified by a stable ID rather than their name, so renaming a group no longer breaks saved state
- Full light/dark mode support via CSS custom properties and `prefers-color-scheme`

### Fixed
- Popup and Options now handle missing storage entries consistently: a service with no saved data is treated as enabled for the menu by default
- Clicking the toolbar icon when both title and services are hidden opens Options directly instead of showing a blank popup

---

## [1.0] — 2026-01-01

### Added
- Initial release
- Intercepts navigation to 24 Google services and redirects through Account Chooser
- Per-service toggles: Intercept and Popup
- Optional popup window mode (chromeless popup instead of current tab)
- Quick-launch icon grid in the extension popup (Menu toggle per service)
- Global enable/disable toggle
- All settings synced via `chrome.storage.sync`
- Supported services: Gmail, Chat, Meet, Calendar, Drive, Docs, Sheets, Slides, Forms, Keep, Contacts, Classroom, Sites, Groups, Photos, Voice, Play, Maps, My Account, One, Admin, Analytics, Ads, Looker Studio, Colab
