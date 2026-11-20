# Privacy

## Single purpose

### Single purpose description

Helps people signed in to several Google accounts open Google services in the right account: Google service links go through Google's Account Chooser before the page loads, and a dashboard and popup show each account (unread mail, an app launcher per account, open tabs, recent files, bookmarks) so services open directly in the intended account.

## Permission justification

### webNavigation

The webNavigation permission is used to detect when the user is about to navigate to a supported Google service (onBeforeNavigate) and to track when a navigation has committed (onCommitted). This allows the extension to intercept the navigation and redirect it through accounts.google.com/AccountChooser before the page loads, so the user can choose which Google account to use.

### tabs

Used to restore or close the original tab when a service opens in a separate window, to open services and dashboard links in new tabs, to list the user's open tabs on the dashboard (by window or by account, all tabs or only Google services) and switch to them, and to show the dashboard in new tabs if the user enables that option. Tab data is only displayed locally; nothing is transmitted or stored remotely.

### tabGroups

Used to mark the user's open tabs on the dashboard with the color and name of the Chrome tab group they belong to (Options → Open tabs → Tab groups). Read locally, never transmitted.

### storage

Stores the user's settings (chrome.storage.sync) and, locally on the device, a cache of the signed-in accounts, their unread counts and unread email headers, plus usage statistics shown on the dashboard, and the files and sites the user adds, pins, removes or re-orders on it. Nothing is sent to the developer or third parties.

### alarms

Wakes the background service worker periodically (every 2 minutes by default, adjustable in Options) to refresh the Gmail unread count badge on the toolbar icon. Manifest V3 service workers stop when idle, so timers alone cannot do this.

### sidePanel

Lets the user choose (Options → Popup) to open the extension's panel in Chrome's side panel instead of the toolbar popup.

### declarativeNetRequestWithHostAccess

A single static rule (rules.json) removes the extension's Origin header from one request type: the extension's own call to accounts.google.com/ListAccounts, which Google rejects when an extension Origin is present. No other requests are blocked, redirected or modified.

### history

Optional, requested only when the user turns on the dashboard's Recent files section, the Most visited section with its source set to browser history, or History in Options → Search → Suggestions. Reads recently visited Google Docs/Sheets/Slides/Forms addresses to list them on the dashboard, grouped by account, and, for Most visited, counts visits per site to list the most visited ones. Once granted, it also suggests visited pages as the user types in the dashboard's search field. Read locally, never transmitted.

### bookmarks

Optional, requested only when the user turns on the dashboard's Bookmarks section, or Bookmarks in Options → Search → Suggestions. Reads the bookmarks bar and Other bookmarks to display a bookmarks bar on the dashboard (which can replace the New Tab page), and, once granted, to suggest bookmarks as the user types in the dashboard's search field. Read-only use; nothing is transmitted.

### topSites

Optional, requested only when the user turns on the dashboard's Most visited section with its source set to Chrome's New Tab list, or Most visited in Options → Search → Suggestions. Reads the list of most visited sites that Chrome keeps for its New Tab page, to display it on the dashboard and, once granted, to suggest those sites as the user types in the dashboard's search field. Read-only use; nothing is transmitted.

### favicon

Optional, requested together with bookmarks or topSites, or with Most visited's other sources, to show each site's icon from Chrome's local favicon cache.

### Host permission

Requested only for accounts.google.com and mail.google.com, to (1) read each signed-in account's unread Gmail messages and count from mail.google.com/mail/u/N/feed/atom, (2) show an email thread the user clicks from mail.google.com/mail/u/N/?view=pt, and (3) read the list of signed-in accounts (name, email, photo) from accounts.google.com/ListAccounts. Routing links through Account Chooser needs no host access; it uses webNavigation and tabs. These requests use the user's existing Google session, run in the browser, and their results are only shown locally.

### Optional host permission (suggestqueries.google.com)

Requested only when the user turns on Google suggestions in Options → Search → Suggestions, which is off by default. While it's on, the text typed in the dashboard's search field is sent to Google's suggestion service (suggestqueries.google.com), as Chrome's address bar does, to show the searches and sites Google suggests for it. Nothing else is sent, and nothing is sent to the developer. Turning it off stops it; the permission can be removed in Chrome's extension settings.

### Optional host permission (open.er-api.com)

Requested only when the user turns on Currency conversion in Options → Search → Suggestions, which is off by default. Downloads ExchangeRate-API's public daily exchange rates (open.er-api.com/v6/latest/EUR), at most every 6 hours, and keeps them on the device to convert amounts typed in the search field. Nothing the user types or any other data is sent; the request carries no user data.

### Are you using remote code?

No, I am not using remote code.

## Data usage

### What user data do you plan to collect from users now or in the future?

None checked (all data is read and shown locally in the browser; nothing is collected by the developer. Only with the optional Google suggestions turned on is the text typed in the search field sent to Google's suggestion service).

### I certify that the following disclosures are true

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

## Privacy policy

### Privacy policy URL

https://itsua.com/gac/
