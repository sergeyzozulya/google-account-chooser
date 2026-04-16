# Google Account Chooser

A Chrome extension that automatically routes Google service links through [Account Chooser](https://accounts.google.com/AccountChooser) so you can pick the right Google account before the page loads — no more accidentally opening Gmail or Drive in the wrong account.

## Features

**Interception**
- Intercepts navigation to 26 Google services and redirects through Account Chooser
- Global on/off toggle — pause all interception without changing any per-service settings
- Per-service **Intercept** toggle

**Popup mode**
- Per-service **Popup** toggle — opens the service in a chromeless popup window instead of the current tab
- Window placement: Center, Tiles (each popup cascades offset from the previous), or Custom (remembers last position per service)
- Window size: Default (1024×768), Large (75% of current window), Full screen, or Custom (remembers last size per service)

**Skip**
- Per-service **Skip** toggle — skips Account Chooser when the URL already specifies a user account (`authuser=` or `/u/N/`)

**Quick-launch menu**
- Per-service **Menu** toggle — adds the service as a quick-launch icon in the extension popup
- Popup appearance options: show/hide the title, the service icon grid, group separators, and service name labels
- **Keyboard navigation**: use arrow keys to navigate between services (toggleable in Options → Menu)

**Service organization**
- Group management: add, rename, and delete groups; at least one group is always kept
- Drag-and-drop reordering of both groups and individual services; services can be moved between groups
- Column-level group toggles: flip Intercept / Popup / Menu / Skip for all services in a group at once; shows indeterminate state when mixed

**Storage**
- All settings synced via `chrome.storage.sync`

## Supported Services

| Group | Services |
|---|---|
| Workspace | Gmail, Chat, Meet, Calendar, Drive, Docs, Sheets, Slides, Forms, Keep, Contacts, Sites, Groups |
| Personal | Gemini, Photos, Voice, Play, Maps, Classroom |
| Account & Storage | My Account, One, Admin |
| Developer & Business | Analytics, Ads, Looker Studio, Colab |

## Installation

**Requires Chrome 109 or later.**

### From Chrome Web Store

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/google-account-chooser/hkhlggddclknhegfmgdipinnefoinlik)

### From Source

1. Clone or download the repository from [GitHub](https://github.com/sergeyzozulya/google-account-chooser)
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `src/` folder

### Package

Create a ZIP file of all extension files:

- `cd google-account-chooser/src`
- `zip -r google-account-chooser.zip . --exclude "*.DS_Store" --exclude ".git/*"`

The ZIP should contain: manifest.json, background.js, popup.html, popup.js, options.html, options.js, services-data.js, and the icons/ folder.

## Usage

Once installed, clicking any link to a supported Google service will redirect you through Account Chooser. Use the extension popup to:

- Toggle the extension on/off
- Launch any supported service directly through Account Chooser
- Open the Options page to configure per-service behavior

### Options Page

Access via the gear icon in the popup, or from `chrome://extensions`.

Each service has four toggles:

| Toggle | Description |
|---|---|
| **Intercept** | Redirect through Account Chooser |
| **Popup** | Open in a chromeless popup window |
| **Menu** | Show as a quick-launch button in the extension popup |
| **Skip** | Skip Account Chooser if the URL already specifies a user (`authuser=` or `/u/N/`) |

Group header rows have matching column toggles that apply to all services in the group at once. Drag the grip handle on any row to reorder services or groups. Use **+ Add group** to create a new group, and the rename/delete buttons in each group header to manage them.

## Privacy

This extension stores only your preferences locally using `chrome.storage.sync`. No data is collected, transmitted, or shared with any third party.

## License

MIT — see [LICENSE](LICENSE)
