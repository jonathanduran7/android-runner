## Purpose
Defines how the extension streams logcat output from ADB, filters it by app PID, handles partial-line buffering, forwards OkHttp lines to the network inspector, and manages the logcat process lifecycle.

## Requirements

### Requirement: PID-filtered logcat streaming
The system SHALL stream logcat output filtered to a specific app process by running `adb -s <deviceId> logcat -v threadtime` and filtering lines by the app's PID.

#### Scenario: Logcat filtered by PID
- **WHEN** the app's PID is resolved after launch
- **THEN** the system SHALL write only logcat lines whose PID field matches the app's PID to the Android Runner output channel

#### Scenario: Unfiltered logcat when PID is unavailable
- **WHEN** the app's PID cannot be resolved (e.g., `applicationId` not configured)
- **THEN** the system SHALL stream all logcat output without PID filtering

### Requirement: App PID resolution
The system SHALL resolve the running app's PID by executing `adb -s <deviceId> shell pidof <packageName>`.

#### Scenario: PID resolved successfully
- **WHEN** the app process is running on the device
- **THEN** the system SHALL return the first PID from the `pidof` output

#### Scenario: App not yet running
- **WHEN** `pidof` returns empty output
- **THEN** the system SHALL return `null`

### Requirement: PID resolution retry
The system SHALL retry PID resolution up to 5 times with 2-second delays if the app is not immediately running after launch.

#### Scenario: PID resolved on retry
- **WHEN** the app starts within the retry window (up to 10 seconds after launch)
- **THEN** the system SHALL resolve the PID and begin filtered logcat streaming

#### Scenario: PID resolution exhausted
- **WHEN** all 5 retry attempts fail to find the PID
- **THEN** the system SHALL proceed with unfiltered logcat streaming

### Requirement: Logcat partial-line buffering
The system SHALL buffer incomplete lines received in logcat data chunks and emit only complete lines.

#### Scenario: Partial line buffered
- **WHEN** an `adb logcat` data event ends without a newline
- **THEN** the system SHALL retain the partial line in a buffer and not emit it until the newline arrives

#### Scenario: Buffered line flushed
- **WHEN** a subsequent data event completes the buffered partial line
- **THEN** the system SHALL emit the full line for filtering and display

### Requirement: OkHttp line forwarding
The system SHALL forward any logcat line containing `"okhttp.OkHttpClient:"` to the OkHttp parser for network inspection.

#### Scenario: OkHttp line detected and forwarded
- **WHEN** a logcat line includes `"okhttp.OkHttpClient:"`
- **THEN** the system SHALL call the `onHttpLine` callback with that line in addition to writing it to the output channel

### Requirement: Logcat stream disposal
The system SHALL provide a `dispose` function that terminates the logcat child process when called.

#### Scenario: Logcat process killed on dispose
- **WHEN** `dispose()` is called on the active logcat stream
- **THEN** the system SHALL kill the underlying `adb logcat` child process and stop all output

#### Scenario: Dispose is idempotent
- **WHEN** `dispose()` is called multiple times
- **THEN** the system SHALL not throw an error on subsequent calls after the process is already terminated

### Requirement: Post-install settle delay
The system SHALL wait 1.5 seconds after Gradle install completes before launching the app to allow the system to register the new APK.

#### Scenario: Settle delay before app launch
- **WHEN** `./gradlew <task>` exits with code 0
- **THEN** the system SHALL pause for 1500 ms before executing `adb shell am start`
