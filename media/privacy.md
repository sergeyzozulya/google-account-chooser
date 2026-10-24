# Privacy

## Single purpose

### Single purpose description

Helps people signed in to several Google accounts open Google services in the right account: Google service links go through Google's Account Chooser before the page loads, and a dashboard and popup show each account (unread mail, an app launcher per account, open tabs, recent files, bookmarks) so services open directly in the intended account.

## Permission justification

### webNavigation

The webNavigation permission is used to detect when the user is about to navigate to a supported Google service (onBeforeNavigate) and to track when a navigation has committed (onCommitted). This allows the extension to intercept the navigation and redirect it through accounts.google.com/AccountChooser before the page loads, so the user can choose which Google account to use.

### tabs

Used to restore or close the original tab when a service opens in a separate window, to open services and dashboard links in new tabs, to list the user's open Google service tabs on the dashboard (grouped by account) and switch to them, and to show the dashboard in new tabs if the user enables that option. Tab data is only displayed locally; nothing is transmitted or stored remotely.

### storage

Stores the user's settings (chrome.storage.sync) and, locally on the device, a cache of the signed-in accounts, their unread counts and unread email headers, plus usage statistics shown on the dashboard. Nothing is sent to the developer or third parties.

### alarms

Wakes the background service worker periodically (every 2 minutes by default, adjustable in Options) to refresh the Gmail unread count badge on the toolbar icon. Manifest V3 service workers stop when idle, so timers alone cannot do this.

### sidePanel

Lets the user choose (Options → General) to open the extension's panel in Chrome's side panel instead of the toolbar popup.

### declarativeNetRequestWithHostAccess

A single static rule (rules.json) removes the extension's Origin header from one request type: the extension's own call to accounts.google.com/ListAccounts, which Google rejects when an extension Origin is present. No other requests are blocked, redirected or modified.

### history

Optional, requested only when the user turns on the dashboard's Recent files section. Reads recently visited Google Docs/Sheets/Slides/Forms addresses to list them on the dashboard, grouped by account. Read locally, never transmitted.

### bookmarks

Optional, requested only when the user turns on the dashboard's Bookmarks section. Reads the bookmarks bar and Other bookmarks to display a bookmarks bar on the dashboard (which can replace the New Tab page). Read-only use; nothing is transmitted.

### favicon

Optional, requested together with bookmarks to show each bookmark's site icon from Chrome's local favicon cache.

### Host permission

Needed for the Google service domains listed in the manifest to (1) detect navigation to them and route it through accounts.google.com/AccountChooser, (2) read each signed-in account's unread Gmail messages and count from mail.google.com/mail/u/N/feed/atom, (3) show an email thread the user clicks from mail.google.com/mail/u/N/?view=pt, and (4) read the list of signed-in accounts (name, email, photo) from accounts.google.com/ListAccounts. These requests use the user's existing Google session, run in the browser, and their results are only shown locally.

### Are you using remote code?

No, I am not using remote code.

## Data usage

### What user data do you plan to collect from users now or in the future?

None checked (all data is read and shown locally in the browser; nothing is collected or transmitted).

### I certify that the following disclosures are true

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

## Privacy policy

### Privacy policy URL

https://itsua.com/gac/
