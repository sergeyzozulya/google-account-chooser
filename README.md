# Google Account Chooser (and Dashboard)

A Chrome extension that automatically routes Google service links through [Account Chooser](https://accounts.google.com/AccountChooser) so you can pick the right Google account before the page loads — no more accidentally opening Gmail or Drive in the wrong account.

## Features

**Account Chooser for Google links**
- Intercepts navigation to 26 Google services and redirects through Account Chooser
- **Intercept Google links** switch (Options → General) pauses all interception without changing per-service settings
- Per-service **Intercept** toggle
- Per-service **Skip** toggle — skips Account Chooser when the URL already specifies an account (`authuser=` or `/u/N/`)
- Per-service **Window** toggle — opens the service in a separate chromeless window; placement (Center, Tiles, Custom) and size (Default, Large, Full screen, Custom) are set in Options → Window

**Dashboard**
- One card per signed-in account: photo, email or nickname, Gmail unread count, and a launcher that opens any service directly in that account (no Account Chooser)
- Chrome-style bookmarks bar: bar items, nested folder menus, » overflow and Other bookmarks; opens in the same tab (Ctrl/⌘-click for a new tab)
- Search Google (default on Enter), or Gmail and Drive in a chosen account via split buttons
- Open Google tabs and recent Docs/Sheets/Slides/Forms (from browser history), grouped by account
- Statistics of the services and accounts you open through the extension
- Bookmarks and Recent files need an extra permission, granted with **Turn on** in the section; nothing is requested at install
- Accounts are detected from your Google session (falling back to Gmail feeds, then a manual count), cached, and refreshed in the background
- Optionally replaces Chrome's New Tab page (Options → General), with an editable tab title

**Popup and side panel**
- The toolbar button opens a popup (default) or the same content in Chrome's side panel, which stays open (Options → General)
- **Show in popup** (Options → Popup): the launcher and any dashboard section except Bookmarks, on or off and in any order
- The popup title is the dashboard title
- A badge on the toolbar icon shows the total Gmail unread count across accounts, refreshed every 2 minutes

**Launcher**
- Per-service **Launcher** toggle — which services the launcher shows (in the popup and in each dashboard account)
- Options → Launcher: group separators, names below icons, keyboard navigation (arrow keys, Home/End)
- Groups: add, rename, delete; drag and drop groups and services, including between groups
- Column toggles on group rows flip Intercept / Window / Skip / Launcher for the whole group (indeterminate when mixed)

**Customization (Options → Dashboard)**
- Accounts: order (drag and drop), nicknames, accounts per row
- Sections: order (drag and drop), width, visibility and title for each section
- Title: date-and-time presets, static text, or a custom format
- Which search buttons appear, and how many recent files to show per account

## Supported Services

| Group | Services |
|---|---|
| Workspace | Gmail, Chat, Meet, Calendar, Drive, Docs, Sheets, Slides, Forms, Keep, Contacts, Sites, Groups |
| Personal | Gemini, Photos, Voice, Play, Maps, Classroom |
| Account & Storage | My Account, One, Admin |
| Developer & Business | Analytics, Ads, Looker Studio, Colab |

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
| `webNavigation`, `tabs` | Routing Google links through Account Chooser; listing open Google tabs |
| `storage` | Settings, account cache, statistics |
| `alarms` | Refreshing the unread badge |
| `declarativeNetRequestWithHostAccess` | Removing the extension's Origin header from Google's account-list request, which Google otherwise rejects |
| `sidePanel` | Showing the popup in Chrome's side panel |
| `history`, `bookmarks`, `favicon` (optional) | Recent files and the bookmarks bar, requested only when you turn them on |
| Host permissions (Google service domains) | Intercepting their links, reading the Gmail unread feed and the account list |

## License

MIT — see [LICENSE](LICENSE)
