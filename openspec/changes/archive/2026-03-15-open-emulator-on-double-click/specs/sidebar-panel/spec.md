## MODIFIED Requirements

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
