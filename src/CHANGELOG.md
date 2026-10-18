# Changelog

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
