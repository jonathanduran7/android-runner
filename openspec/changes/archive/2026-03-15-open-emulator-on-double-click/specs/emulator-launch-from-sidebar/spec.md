## ADDED Requirements

### Requirement: Start emulator from sidebar
The system SHALL register a command `androidRunner.startEmulator` that accepts an AVD name as its argument and launches that emulator using the existing `startEmulator()` lifecycle function.

#### Scenario: Non-running emulator clicked in sidebar
- **WHEN** the user double-clicks a non-running AVD entry in the Emulators sidebar section
- **THEN** the system SHALL invoke `androidRunner.startEmulator` with that AVD's name and begin the emulator launch process

#### Scenario: Running emulator item is inert
- **WHEN** the user clicks an emulator entry that is already marked as running
- **THEN** the system SHALL NOT invoke any command and the click SHALL have no effect

#### Scenario: Start emulator command invoked via command palette
- **WHEN** the user runs `androidRunner.startEmulator` from the command palette with a valid AVD name
- **THEN** the system SHALL launch that AVD using the configured SDK path
