## Purpose
Defines how the extension enumerates physical Android devices and emulators via ADB, manages emulator lifecycle (start, wait for boot, terminate), and waits for devices to become available.

## Requirements

### Requirement: Physical device enumeration
The system SHALL detect USB-connected Android devices by executing `adb devices -l` and filtering out emulator entries.

#### Scenario: Physical devices detected
- **WHEN** one or more USB-connected Android devices are authorized for debugging
- **THEN** the system SHALL return a list of devices each with their ADB serial ID and model name parsed from the `model:` field in `adb devices -l` output

#### Scenario: No physical devices connected
- **WHEN** no USB devices are connected or all connected devices are unauthorized
- **THEN** the system SHALL return an empty list without error

### Requirement: Running emulator detection
The system SHALL identify the currently running Android emulator by filtering ADB devices whose serial ID starts with `emulator-`.

#### Scenario: Emulator is active
- **WHEN** an Android emulator is running
- **THEN** the system SHALL return the first emulator's ADB device ID (e.g., `emulator-5554`)

#### Scenario: No emulator running
- **WHEN** no emulator processes are detected in the ADB device list
- **THEN** the system SHALL return `null`

### Requirement: AVD enumeration
The system SHALL list all configured Android Virtual Devices (AVDs) by executing `emulator -list-avds`.

#### Scenario: AVDs are configured
- **WHEN** AVDs are set up in the Android SDK
- **THEN** the system SHALL return a list of AVD name strings

#### Scenario: No AVDs configured
- **WHEN** no AVDs have been created
- **THEN** the system SHALL return an empty list

### Requirement: Device ready polling
The system SHALL wait for an ADB device to be available using `adb wait-for-device` before performing device operations after emulator start.

#### Scenario: Device becomes available
- **WHEN** a device comes online within 5 seconds of the call
- **THEN** `waitForDevice` SHALL resolve successfully

#### Scenario: Wait-for-device timeout
- **WHEN** no device comes online within the 5-second timeout
- **THEN** `waitForDevice` SHALL resolve without throwing an error (silent failure)

### Requirement: Emulator startup
The system SHALL start an AVD as a fully detached background process using `emulator -avd <name>`.

#### Scenario: Emulator launched detached
- **WHEN** an AVD name is provided and the emulator executable is resolved
- **THEN** the system SHALL spawn the emulator process with `detached: true` and call `child.unref()` so the emulator outlives the extension process

### Requirement: Emulator boot wait
The system SHALL poll for the emulator to fully boot after starting it, retrying every 5 seconds up to a configurable timeout (default 300 seconds).

#### Scenario: Emulator boots within timeout
- **WHEN** the emulator becomes visible in `adb devices` within the timeout
- **THEN** the system SHALL call `waitForDevice()` and resolve successfully

#### Scenario: Emulator boot timeout exceeded
- **WHEN** the emulator does not appear in `adb devices` within the timeout
- **THEN** the system SHALL reject with a timeout error

### Requirement: Emulator termination
The system SHALL terminate a running emulator by executing `adb -s <deviceId> emu kill`.

#### Scenario: Emulator killed
- **WHEN** `killEmulator` is called with a valid device ID
- **THEN** the system SHALL execute `adb emu kill` and the emulator process SHALL terminate
