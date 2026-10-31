# Google Account Chooser (and Dashboard)

A Chrome extension that automatically routes Google service links through [Account Chooser](https://accounts.google.com/AccountChooser) so you can pick the right Google account before the page loads — no more accidentally opening Gmail or Drive in the wrong account.

## Features

**Account Chooser for Google links**
- Intercepts navigation to 35 Google services and redirects through Account Chooser
- **Intercept Google links** switch (Options → General) pauses all interception without changing per-service settings
- Per-service **Intercept** toggle (Options → Services)
- Per-service **Skip** toggle — skips Account Chooser when the URL already specifies an account (`authuser=` or `/u/N/`)
- Per-service **Window** toggle — opens the service in a separate chromeless window; placement (Center, Tiles, Custom) and size (Default, Large, Full screen, Custom) are set in Options → Services → Window

**Dashboard**
- All signed-in accounts on one panel: photo, email or nickname, Gmail unread count and unread emails, and a launcher that opens any service directly in that account (no Account Chooser); side by side when the section is full width, one per row otherwise
- Chrome-style bookmarks bar: bar items, nested folder menus, » overflow and Other bookmarks; narrower than full width, a list whose folders open in place
- Search Google (default on Enter), or Gmail and Drive in a chosen account via split buttons
- Open tabs: all tabs or only Google services, grouped by window (installed web apps under their own name), by account or not at all, with close buttons, Chrome tab group colors and optional account avatars
- Recent Docs/Sheets/Slides/Forms from browser history, grouped by account or type, filtered by type and period, sorted by last opened or most visited, with optional account avatars and a choice of date and time formats
- Statistics of the services and accounts you open through the extension
- Bookmarks and Recent files need an extra permission, granted with **Turn on** in the section; nothing is requested at install
- Accounts are detected from your Google session (falling back to Gmail feeds, then a manual count), cached, and refreshed in the background; the dashboard also refreshes when its tab is selected or its window focused
- Optionally replaces Chrome's New Tab page (Options → General), with an editable tab title

**Popup and side panel**
- The toolbar button opens a popup (default) or the same content in Chrome's side panel, which stays open (Options → General)
- The toolbar icon (Options → General) and the dashboard's icon (Options → Dashboard) can each show the date, the time or both, or another picture
- Options → Popup → **Sections**: the launcher and any dashboard section except Bookmarks, on or off and in any order; **Layout**: all expanded, or an accordion with one section open at a time
- Arrow keys move through everything: the header buttons, the launcher and every section
- The popup title is the dashboard title
- A badge on the toolbar icon shows the Gmail unread count across accounts or for one account, refreshed as often as Options → Gmail → Check mail every

**Launcher**
- Per-service **Launcher** toggle — which services the launcher shows (in the popup and in each dashboard account)
- Options → Launcher: group separators and names below icons; arrow keys and Home/End move between services
- Groups: add, rename, delete; drag and drop groups and services, including between groups
- Column toggles on group rows flip Intercept / Window / Skip / Launcher for the whole group (indeterminate when mixed)

**Customization**
- Options → General → Accounts: order (drag and drop), nicknames, and which accounts show
- Options → Interface → Dashboard: section order (drag and drop), width, visibility and title; header title (date-and-time presets, static text or a custom format); where links and new tabs open; placement, size and section height
- Options → Interface → Search: which search buttons show
- Options → Interface → Popup, Gmail, Open tabs, Recent files and Launcher: the options above

## Supported Services

| Group | Services |
|---|---|
| Connect | Gmail, Chat, Meet, Calendar, Contacts, Groups, Voice |
| Create | Docs, Sheets, Slides, Forms, Sites, Keep, Tasks |
| Access | Drive, Photos, One |
| AI | Gemini, NotebookLM |
| Everyday | Maps, Play, Classroom |
| Marketing & Business | Analytics, Ads, Tag Manager, Search Console, Looker Studio, Merchant Center, Business Profile, AdSense |
| Developer | Cloud Console, Firebase, Colab |
| Control | My Account, Admin |

## Installation

**Requires Chrome 114 or later.**

### From Chrome Web Store

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/google-account-chooser/hkhlggddclknhegfmgdipinnefoinlik)

### From Source

1. Clone or download the repository from [GitHub](https://github.com/sergeyzozulya/google-account-chooser)
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `src/` folder

### Package

```
./package.sh
```

Creates `dist/google-account-chooser-<version>.zip` from `src/`, using the version in `manifest.json` (excludes `.DS_Store` and Chrome's generated `_metadata/`).

### Changelog

[src/CHANGELOG.md](src/CHANGELOG.md) ships with the extension: the **What's new** page (opened once after each update, and from the ? icon in the Options header) shows it under a slider of the store screenshots in `src/screens/`.

### Images

Icons, UI screenshots and Chrome Web Store images are generated from `media/icon.svg`, the extension pages, and the templates in `scripts/images/`:

```
node scripts/build-images.mjs
```

Requires Node 22+ and Google Chrome (set `CHROME=/path/to/chrome` if it isn't in the default macOS location).

## Usage

Once installed, clicking a link to a supported Google service shows Account Chooser first. From the toolbar button you can:

- Launch any service (through Account Chooser)
- See the sections you added to the popup: accounts with unread mail and per-account launchers, search, open tabs, recent files, statistics
- Open the dashboard or the Options page

### Options Page

Open it from the gear icon in the popup or dashboard, or from `chrome://extensions`. Sections: General, Dashboard, Popup, Launcher, Services and Window.

Each service has four toggles:

| Toggle | Description |
|---|---|
| **Intercept** | Redirect through Account Chooser |
| **Window** | Open in a separate chromeless window |
| **Skip** | Skip Account Chooser if the URL already specifies a user (`authuser=` or `/u/N/`) |
| **Launcher** | Show as a quick-launch button in the launcher |

Group header rows have matching column toggles that apply to all services in the group at once. Drag the grip handle on any row to reorder services or groups. Use **+ Add group** to create a new group, and the rename/delete buttons in each group header to manage them.

## Privacy

Everything runs in your browser. The extension doesn't ask you to sign in and doesn't use Google APIs: account names, photos and unread counts are read from Google with your existing session, the same way Google's own pages do. Settings are stored with `chrome.storage.sync`; the account cache and statistics stay in local storage. Browser history and bookmarks are read only after you turn those sections on, and never leave your device. No data is collected, transmitted, or shared with any third party.

### Permissions

| Permission | Used for |
|---|---|
| `webNavigation`, `tabs` | Routing Google links through Account Chooser; listing open tabs |
| `tabGroups` | Marking open tabs with the color of their Chrome tab group |
| `storage` | Settings, account cache, statistics |
| `alarms` | Refreshing the unread badge |
| `declarativeNetRequestWithHostAccess` | Removing the extension's Origin header from Google's account-list request, which Google otherwise rejects |
| `sidePanel` | Showing the popup in Chrome's side panel |
| `history`, `bookmarks`, `favicon` (optional) | Recent files and the bookmarks bar, requested only when you turn them on |
| Host permissions (`accounts.google.com`, `mail.google.com`) | Reading the account list, the Gmail unread feed and email threads |

## License

MIT — see [LICENSE](LICENSE)
