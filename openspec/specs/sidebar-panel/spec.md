## Purpose
Defines the Android Runner sidebar UI: the Activity Bar container, the Android panel (actions, devices, emulators, flavors), the Network panel (transaction list), and the manual refresh behavior.

## Requirements

### Requirement: Android Activity Bar container
The system SHALL register a VS Code Activity Bar container named "Android Runner" with a custom Android icon that hosts both the Android and Network sidebar panels.

#### Scenario: Activity Bar icon visible with workspace
- **WHEN** any workspace is open in VS Code / Cursor
- **THEN** the Android icon SHALL appear in the Activity Bar and clicking it SHALL reveal the Android Runner sidebar

### Requirement: Android sidebar action buttons
The system SHALL display clickable action buttons at the root of the Android sidebar that trigger the most common extension commands.

#### Scenario: Action buttons rendered at root
- **WHEN** the Android sidebar is open
- **THEN** the following action buttons SHALL be visible: Run & Stream Logs, Reinstall Last APK, Logs, Stop Logs, Kill Emulator, Focus Logs

#### Scenario: Action button invokes command
- **WHEN** the user clicks an action button
- **THEN** the corresponding extension command SHALL execute

### Requirement: Devices folder section
The system SHALL display a collapsible "Devices" folder in the Android sidebar that lazily loads and lists all connected USB physical devices.

#### Scenario: Physical devices listed under Devices folder
- **WHEN** the Devices folder is expanded
- **THEN** the system SHALL show each physical device with its model name and ADB serial ID

#### Scenario: No physical devices
- **WHEN** no USB devices are connected
- **THEN** the Devices folder SHALL appear empty without error

### Requirement: Emulators folder section
The system SHALL display a collapsible "Emulators" folder that lists all configured AVDs and indicates which one is currently running. Non-running AVD items SHALL be clickable and trigger the `androidRunner.startEmulator` command with the AVD name as argument. Running AVD items SHALL remain inert on click.

#### Scenario: All AVDs listed
- **WHEN** the Emulators folder is expanded
- **THEN** the system SHALL show each configured AVD name

#### Scenario: Running emulator highlighted
- **WHEN** an emulator is currently active
- **THEN** the matching AVD entry SHALL display a `running` badge

#### Scenario: Non-running emulator item launches on double-click
- **WHEN** the user double-clicks a non-running AVD entry in the Emulators folder
- **THEN** the system SHALL invoke `androidRunner.startEmulator` with that AVD name

#### Scenario: Running emulator item is not clickable
- **WHEN** an AVD entry is shown with the `running` badge
- **THEN** clicking it SHALL have no effect

### Requirement: Flavors folder section
The system SHALL display a collapsible "Flavors" folder that lists all discovered Gradle install tasks.

#### Scenario: Install tasks listed as flavors
- **WHEN** the Flavors folder is expanded
- **THEN** the system SHALL show all `:app:installXxx` tasks found in the project

#### Scenario: Flavor item triggers install
- **WHEN** the user clicks a flavor item
- **THEN** the system SHALL invoke `androidRunner.installFlavor` with the task string as argument

### Requirement: Manual sidebar refresh
The system SHALL provide a Refresh command that reloads the Devices, Emulators, and Flavors sections on demand.

#### Scenario: Refresh reloads all sections
- **WHEN** the user invokes `Android Runner: Refresh` (command palette or toolbar button)
- **THEN** all three folder sections SHALL re-query their data sources and update their children

### Requirement: No automatic sidebar refresh
The system SHALL NOT auto-refresh the sidebar; all updates SHALL be triggered explicitly by the user.

#### Scenario: Sidebar data is static between refreshes
- **WHEN** a device is connected or an emulator starts while the sidebar is open
- **THEN** the sidebar SHALL NOT update automatically until the user triggers a manual refresh

### Requirement: Network sidebar panel
The system SHALL provide a separate "Network" panel in the Android Runner Activity Bar container that displays HTTP transactions in real time.

#### Scenario: Network panel updates in real time
- **WHEN** the OkHttp parser completes a new HTTP transaction
- **THEN** the Network panel SHALL update immediately without requiring a manual refresh

### Requirement: Focus Logs command
The system SHALL register an `androidRunner.focusLogs` command that brings the Android Runner output channel into the foreground.

#### Scenario: Output channel focused
- **WHEN** the user invokes `Android: Focus Logs`
- **THEN** the Android Runner output channel SHALL be shown and brought into focus in the editor
