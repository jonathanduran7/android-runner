## Purpose
Defines the five VS Code status bar quick-access buttons provided by the extension, their visibility conditions, command bindings, and ordering.

## Requirements

### Requirement: Status bar buttons rendered when workspace is open
The system SHALL display five quick-access buttons in the VS Code status bar whenever a workspace folder is open.

#### Scenario: Status bar buttons visible with workspace
- **WHEN** a workspace folder is open in VS Code / Cursor
- **THEN** the following five buttons SHALL be visible in the status bar (left-aligned): `▷ Run`, `⧉ Logs`, `◼ Stop`, `↻ Reinstall`, `🗑 Kill`

#### Scenario: Status bar buttons hidden without workspace
- **WHEN** no workspace folder is open
- **THEN** all five status bar buttons SHALL be hidden

### Requirement: Run button
The system SHALL provide a `▷ Run` status bar button that triggers the full Run & Stream Logs command.

#### Scenario: Run button invokes runAndLogs command
- **WHEN** the user clicks the `▷ Run` status bar button
- **THEN** the system SHALL execute `androidRunner.runAndLogs`

### Requirement: Logs button
The system SHALL provide a `⧉ Logs` status bar button that attaches logcat to an already-running app.

#### Scenario: Logs button invokes logs command
- **WHEN** the user clicks the `⧉ Logs` status bar button
- **THEN** the system SHALL execute `androidRunner.logs`

### Requirement: Stop button
The system SHALL provide a `◼ Stop` status bar button that stops the logcat stream without killing the emulator.

#### Scenario: Stop button invokes stopLogs command
- **WHEN** the user clicks the `◼ Stop` status bar button
- **THEN** the system SHALL execute `androidRunner.stopLogs`

### Requirement: Reinstall button
The system SHALL provide a `↻ Reinstall` status bar button that re-runs the last Gradle task on the current device.

#### Scenario: Reinstall button invokes reinstallLast command
- **WHEN** the user clicks the `↻ Reinstall` status bar button
- **THEN** the system SHALL execute `androidRunner.reinstallLast`

### Requirement: Kill button
The system SHALL provide a `🗑 Kill` status bar button that stops logcat and terminates the running emulator.

#### Scenario: Kill button invokes killEmulator command
- **WHEN** the user clicks the `🗑 Kill` status bar button
- **THEN** the system SHALL execute `androidRunner.killEmulator`

### Requirement: Status bar button priority ordering
The system SHALL assign decreasing alignment priorities to the status bar buttons so they render in a consistent left-to-right order.

#### Scenario: Buttons appear in correct visual order
- **WHEN** the status bar is rendered
- **THEN** the buttons SHALL appear left-to-right as: Run, Logs, Stop, Kill, Reinstall — achieved via descending priority values (400 → 100)
