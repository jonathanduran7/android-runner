## Purpose
Defines the end-to-end Android run orchestration: device/task selection, emulator lifecycle, Gradle install, app launch, logcat streaming, reinstall shortcut, and session state management.

## Requirements

### Requirement: Device and task selection via QuickPick
When invoking Run & Stream Logs, the system SHALL prompt the user to select a target device and a Gradle install task via VS Code QuickPick dialogs.

#### Scenario: QuickPick shows physical devices, running emulator, and AVDs
- **WHEN** the user invokes `Android: Run & Stream Logs`
- **THEN** the system SHALL present a QuickPick showing: any connected physical devices (at the top), a "Use running emulator" option if one is active, and all configured AVD names

#### Scenario: QuickPick shows available Gradle install tasks
- **WHEN** the user selects a device
- **THEN** the system SHALL present a second QuickPick showing all `:app:installXxx` tasks discovered by Gradle

#### Scenario: User cancels device picker
- **WHEN** the user dismisses the device QuickPick
- **THEN** the system SHALL abort the run flow without error

#### Scenario: User cancels task picker
- **WHEN** the user dismisses the task QuickPick
- **THEN** the system SHALL abort the run flow without error

### Requirement: Full run orchestration
The system SHALL execute the complete Android run sequence: optionally start an emulator, run Gradle install, launch the app, and stream logcat.

#### Scenario: Full run with AVD
- **WHEN** the user selects an AVD name (not a running emulator or physical device)
- **THEN** the system SHALL start the emulator, wait for it to boot, run `./gradlew <task>`, launch the app, and start streaming logcat

#### Scenario: Full run with physical device or running emulator
- **WHEN** the user selects a physical device or the running emulator option
- **THEN** the system SHALL skip emulator startup and proceed directly to Gradle install, app launch, and logcat streaming

### Requirement: Run Staging shortcut
The system SHALL provide a `Android: Run Staging` command that bypasses all QuickPick dialogs using configured defaults.

#### Scenario: Run Staging with defaults
- **WHEN** the user invokes `Android: Run Staging`
- **THEN** the system SHALL use `androidRunner.defaultAvd` as the AVD name and `installStaging` as the Gradle task, executing the full run flow without any prompts

### Requirement: Reinstall Last APK
The system SHALL re-run the most recent Gradle install task on the currently running device without restarting the emulator.

#### Scenario: Reinstall on existing emulator
- **WHEN** the user invokes `Android: Reinstall Last APK` and a previous run context exists
- **THEN** the system SHALL run the last Gradle task on the current device, relaunch the app, and restart logcat without emulator restart

#### Scenario: No previous run
- **WHEN** `Android: Reinstall Last APK` is invoked but no prior run has occurred in this session
- **THEN** the system SHALL display an error notification and abort

### Requirement: Logs-only attach
The system SHALL attach logcat to an already-running app without performing a Gradle build or app launch.

#### Scenario: Logs-only when app is running
- **WHEN** the user invokes `Android: Logs` and selects a configured app ID from `taskAppIds`
- **THEN** the system SHALL resolve the app's PID and start streaming filtered logcat without running Gradle

#### Scenario: App not running during logs attach
- **WHEN** the selected app is not running at the time of the `Android: Logs` command
- **THEN** the system SHALL launch the app and then stream logcat

### Requirement: App launch with retry
The system SHALL launch the app after Gradle install and retry up to 5 times with a 2-second delay if the app does not start immediately.

#### Scenario: App launches on first attempt
- **WHEN** the app is installed and ready
- **THEN** the system SHALL resolve the launcher component via `adb shell cmd package resolve-activity` and execute `adb shell am start -n <component>`

#### Scenario: App launch retries on failure
- **WHEN** the app is not immediately running after `am start`
- **THEN** the system SHALL retry up to 5 times with 2-second delays before failing

### Requirement: Session state tracking
The system SHALL retain the last run context in memory for use by the Reinstall command.

#### Scenario: lastRun updated after successful run
- **WHEN** a run completes successfully
- **THEN** the system SHALL store `{ projectRoot, gradleTask, appId }` as `lastRun` for the session

#### Scenario: Stop Logs preserves session state
- **WHEN** the user invokes `Android: Stop Logs`
- **THEN** the system SHALL stop only the logcat stream, keeping the emulator running and `lastRun` intact

### Requirement: Emulator lifecycle on session stop
The system SHALL optionally kill the emulator when stopping a session, based on the `keepEmulator` setting.

#### Scenario: Emulator killed on session stop
- **WHEN** `androidRunner.keepEmulator` is `false` and the extension started the emulator
- **THEN** `logcatDispose` SHALL stop logcat AND kill the emulator

#### Scenario: Emulator kept on session stop
- **WHEN** `androidRunner.keepEmulator` is `true`
- **THEN** `logcatDispose` SHALL stop only the logcat stream without killing the emulator

### Requirement: Workspace and Gradle validation
The system SHALL validate that a workspace folder and a Gradle wrapper (`gradlew`) exist before executing run commands.

#### Scenario: No workspace open
- **WHEN** a run command is invoked without an open workspace folder
- **THEN** the system SHALL display an error notification and abort

#### Scenario: Gradle wrapper missing
- **WHEN** `gradlew` is not found at the project root (or `androidRunner.gradleRoot` path)
- **THEN** the system SHALL display an error notification and abort

### Requirement: Lifecycle notifications
The system SHALL display VS Code popup notifications for key lifecycle events when `androidRunner.notifications` is `true`.

#### Scenario: Notifications enabled
- **WHEN** `androidRunner.notifications` is `true` and a lifecycle event occurs (install complete, app launched, etc.)
- **THEN** the system SHALL show a VS Code information or warning notification

#### Scenario: Notifications suppressed
- **WHEN** `androidRunner.notifications` is `false`
- **THEN** the system SHALL not show any popup notifications
