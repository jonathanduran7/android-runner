# Changelog

All notable changes to the **Android Runner** extension will be documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- New setting `androidRunner.gradleRoot`: relative path from the workspace root to the directory containing `gradlew` (e.g. `"android"` for React Native, Expo, and Flutter projects). Leave empty to keep the default behavior (workspace root).

---

## [0.0.4] - 2025

### Added
- **Clear Network Log** command and button in the Network view toolbar.
- Safe command registration to avoid "already registered" errors when the extension runs in both installed and development mode simultaneously.

### Changed
- Repository metadata added to `package.json`.
- `.vscodeignore` updated to exclude GIF demo assets from the published package.

---

## [0.0.3] - 2025

### Added
- **Physical device support**: connected Android devices now appear alongside AVDs in the device picker.
- **Network log view**: new *Network* panel in the Android Runner sidebar that captures and displays OkHttp HTTP/HTTPS traffic (method, URL, status code, duration, response body).
- **Auto-detection of `applicationId`**: the extension now parses `app/build.gradle` / `app/build.gradle.kts` to resolve the application ID for each install task automatically, including support for product flavors, build types, `applicationIdSuffix`, and compound flavor+buildType names (e.g. `installStagingDebug`).
- Network log entries include JSON pretty-printing and status-based icons.

### Fixed
- Launcher activity is now resolved before starting the app, improving launch reliability.

---

## [0.0.2] - 2025

### Added
- Extension icon (`resources/logo.png`).
- Publisher information in `package.json`.

### Fixed
- Publisher name format corrected in `package.json`.

---

## [0.0.1] - 2025

### Added
- Initial release.
- **Run & Stream Logs** command: picks an AVD or running emulator, runs a Gradle install task, launches the app, and streams filtered logcat output.
- **Run Staging** command: one-click shortcut for the `:app:installStaging` task.
- **Reinstall Last APK** command: reinstalls on the already-running emulator without restarting it.
- **Logs** command: attach logcat to an already-running app by `applicationId`.
- **Stop Logs** / **Kill Emulator** commands.
- Status bar items: *Run*, *Logs*, *Stop*, *Reinstall*, *Kill*.
- Android Runner sidebar view (Activity Bar) showing emulator and flavor info.
- `androidRunner.defaultAvd`, `androidRunner.keepEmulator`, `androidRunner.taskAppIds`, `androidRunner.sdkPath`, and `androidRunner.notifications` settings.
- Notification system for emulator ready, install complete, app launched, and log streaming events.
