# Changelog

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
