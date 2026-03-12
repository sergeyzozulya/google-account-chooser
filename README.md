# Google Account Chooser

A Chrome extension that automatically routes Google service links through [Account Chooser](https://accounts.google.com/AccountChooser) so you can pick the right Google account before the page loads — no more accidentally opening Gmail or Drive in the wrong account.

## Features

- Intercepts navigation to 25+ Google services and redirects through Account Chooser
- Optional **popup mode** — opens the service in a chromeless popup window instead of the current tab
- Optional **quick-launch menu** — icon grid in the extension popup for one-click access to services
- Per-service controls: intercept, popup, menu, and skip-if-account-set
- Popup window placement: centered, tiled (cascading), or custom (remembers last position per service)
- Popup window size: default (1024×768), large (75%), full screen, or custom (remembers last size per service)
- Global on/off toggle without losing per-service settings
- All settings synced via `chrome.storage.sync`

## Supported Services

| Group | Services |
|---|---|
| Workspace | Gmail, Chat, Meet, Calendar, Drive, Docs, Sheets, Slides, Forms, Keep, Contacts, Sites, Groups |
| Personal | Gemini, Photos, Voice, Play, Maps, Classroom |
| Account & Storage | My Account, One, Admin |
| Developer & Business | Analytics, Ads, Looker Studio, Colab |

## Installation

### From Source

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `src/` folder

### Package

Create a ZIP file of all extension files:

`cd google-account-chooser/src`

`zip -r google-account-chooser.zip . --exclude "*.DS_Store" --exclude ".git/*"`

The ZIP should contain: manifest.json, background.js, popup.html, popup.js, options.html, options.js, services-data.js, and the icons/ folder.

### From Chrome Web Store

*(Coming soon)*

## Usage

Once installed, clicking any link to a supported Google service will redirect you through Account Chooser. Use the extension popup to:

- Toggle the extension on/off
- Launch any supported service directly through Account Chooser
- Open the Options page to configure per-service behavior

### Options Page

Access via the "Manage services & popup settings" link in the popup, or from `chrome://extensions`.

Each service has four toggles:

| Toggle | Description |
|---|---|
| **Intercept** | Redirect through Account Chooser |
| **Popup** | Open in a chromeless popup window |
| **Menu** | Show as a quick-launch button in the extension popup |
| **Skip** | Skip Account Chooser if the URL already specifies a user (`authuser=` or `/u/N/`) |

## Privacy

This extension stores only your preferences locally using `chrome.storage.sync`. No data is collected, transmitted, or shared with any third party.

## License

MIT — see [LICENSE](LICENSE)
