<p align="center">
  <img src="apps/extension/assets/icon.svg" width="96" height="96" alt="StillTab icon">
</p>

<h1 align="center">StillTab · 停一下</h1>
<p align="center"><strong>A little pause. A more intentional web.</strong></p>
<p align="center">English · <a href="README.zh-CN.md">简体中文</a></p>

StillTab is a browser extension that helps you set your own browsing boundaries. Add a reminder, a short wait, or a blocking overlay to selected websites, then decide when those rules apply.

It runs on your device, without an account or a backend. The current interface is in Simplified Chinese and uses the name **停一下 · 网页行为规则**. **StillTab** is the English project name: *still* for a moment of calm, *tab* for the place where browsing happens.

![StillTab rule management interface](docs/store/screenshots/01-rules.png)

## What you can do

- **Choose an action:** show a reminder, wait for a countdown before continuing, or block the page with an overlay.
- **Choose a scope:** an entire site, a URL path, or one specific page; add exceptions where needed.
- **Choose a schedule:** selected weekdays and time ranges, including ranges that cross midnight.
- **Set a daily allowance:** apply the selected action after a rule's browsing-time allowance is used.
- **Take a temporary break from a rule:** allow it for 15 minutes, or end that allowance early.
- **Make it personal:** edit reminder and button text, start from templates, and preview a rule before saving.
- **Keep control of your settings:** enable or disable rules, view recent triggers, and export or import a JSON configuration.

A fresh installation starts with **no enabled rules**. Templates are added only when you choose them.

<details>
<summary>Preview the waiting screen</summary>

![A 30-second waiting screen](docs/store/screenshots/04-wait.png)

</details>

## Install from source

Requirements: **Node.js 20 or newer**, npm, and a desktop Chromium browser. The manifest requires Chrome 120 or newer; Edge uses the same Manifest V3 build.

Download or clone this repository, then run these commands from its root:

```sh
cd apps/extension
npm ci
npm run build
```

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this repository's `apps/extension/dist` directory.
4. Pin the extension, open a normal HTTP or HTTPS webpage, and use the popup to create your first rule.

The build generates the manifest, icons, styles, and JavaScript in `dist/`. It also mirrors generated runtime files into `apps/extension/` to support existing local installations. Generated files are excluded from Git.

To update an unpacked installation, rebuild and click **Reload** on its extension card. Reloading keeps its existing local configuration; uninstalling may remove it.

## Try one rule

Open a site you tend to visit out of habit. Create a **等待后放行** (wait before continuing) rule, set the delay to 5 seconds, leave the schedule off, and keep the daily allowance unlimited. Save it, return to the page, and wait for the countdown. You can change the rule to **仅提醒** (reminder) or **直接拦截** (blocking overlay) at any time.

After you confirm a reminder or finish a wait, refreshing the same address does not repeat it immediately. Leaving that address and returning can trigger the rule again.

## Privacy and permissions

The extension reads webpage addresses, active-tab and window-focus state, and the system's lock state to match rules and measure foreground browsing time. It stores rules, daily usage, temporary allowances, and recent trigger records locally, with per-tab execution state in session storage.

- No account, analytics, telemetry, advertising, cloud sync, or developer-operated backend.
- No extraction of webpage text, form values, messages, images, or media content. When a wait or block applies, the extension attempts to pause media elements it can find.
- Trigger records store the origin and path, without query strings or fragments. User-saved exact-page rules and session state can contain full URLs.
- Exported JSON contains rule settings, not trigger records or daily usage.
- Custom reminder text and rule labels appear in the webpage's DOM and may be readable by that site. Avoid putting secrets in them.

| Permission | Why it is needed |
| --- | --- |
| `storage` | Save local rules, usage, records, allowances, and session state. |
| `scripting` | Load the bundled content script into eligible tabs already open at install, update, or startup. |
| `alarms` | Recheck schedules and temporary allowances when the background worker wakes. |
| `webNavigation` | Reevaluate rules after single-page app navigation and fragment changes. |
| `idle` | Pause time accounting while the system is locked. |
| HTTP/HTTPS host access | Apply user-defined rules automatically on ordinary websites. |

Full policy: [隐私政策](docs/store/隐私政策.md). Processing stays local, but that still means the extension accesses user data.

## Limits to understand

- This is a tool for personal self-management. You can disable rules, allow a rule temporarily, or remove the extension.
- Blocking uses an overlay. A page may load content or send network requests before the overlay appears.
- Browser settings, extension stores, local files, and other protected pages are outside its supported scope.
- Usage is counted for eligible active pages in the focused window. Background tabs, waiting or blocked pages, and locked-screen periods do not accrue browsing time.
- The interface is currently Chinese. Firefox and Safari ports are not provided.
- Browser timing and compatibility need further testing across sites and long sessions. As of October 14, 2026, the extension passed 36 unit tests and 26 Edge browser checks. One earlier timing check failed before passing on reruns; the cause was not established. Chrome was not rerun in that release's browser regression. See the [verification report](docs/store/发布包验证.md).

## Development

Run these commands inside `apps/extension`:

```sh
npm run typecheck
npm test
npm run build
```

The UI uses TypeScript, HTML, and CSS; esbuild bundles the extension, and Sharp generates PNG icons from the source SVG. There is no application server.

### Browser regression

The current Playwright harness is configured for **Windows** with Edge at its standard installation path. Build first, then run:

```powershell
npm run test:browser
```

It opens a separate browser profile, serves local fixture pages, and writes evidence under `work/`. It does not use your everyday browser profile. Keep the test windows available while foreground-timing checks run. Chrome can be selected with `$env:TEST_BROWSER = 'chrome'`; its configured path must exist, and automated extension loading depends on the browser version. Other operating systems require adjusting the executable path in the harness.

### Repository map

```text
apps/
  extension/
    assets/          Source icon
    src/core/        Rule types, matching, schedules, quotas, validation
    src/runtime.ts   Time accounting and per-page execution state
    src/background.ts
    src/content.ts   Reminder, wait, and block interfaces
    src/options.ts   Rule management
    src/popup.ts     Current-page status and quick creation
    scripts/         Build, unit tests, store artwork
    tests/           Unit and browser regression tests
  mobile/            Flutter companion with Android and iOS platform code
docs/
  store/             Store copy, privacy policy, screenshots, submission guide
  mobile/            Mobile design, setup, and verification notes
scripts/             Local packaging and mobile build helpers
```

Start with [development notes](docs/开发说明.md) and [rule semantics](docs/设计与规则语义.md). These documents are currently in Chinese.

## Mobile companion

This repository also contains a Flutter companion in [apps/mobile](apps/mobile/README.md). Android 8.0+ support uses an accessibility service for app detection and overlays. The current local APK is an ARM64 debug build; on-device permission, overlay, and background-lifecycle checks are still required. iOS includes Screen Time integration code but needs macOS, entitlements, signing, and iPhone validation; there is no verified iOS release.

The root PowerShell mobile helpers use the author's local `D:/code` toolchain paths. They are not portable setup scripts. Configure your own Flutter and platform SDKs before building the mobile app.

## Contributing

Small, focused issues and pull requests are welcome. For a bug, include browser/OS versions, steps to reproduce, expected behavior, and a minimal rule that reproduces it. Remove personal URLs and sensitive reminder text before sharing screenshots or exported rules.

Run type checking and unit tests for extension changes. Run the browser checks for changes to matching, timing, navigation, permissions, or rule execution. Include screenshots for visible UI changes. Preserve the local-data design and document any new permissions.

## Store distribution

The repository can be built and loaded locally. Chrome Web Store and Edge Add-ons listings have not been published as of October 14, 2026. Store assets and submission instructions are in [docs/store](docs/store/上传步骤.md); release archives are generated locally and are not part of the source tree.

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses.
