## Purpose
Defines how the extension resolves the Android SDK root path and derives executable paths for `adb` and `emulator`, ensuring child processes have the correct environment.

## Requirements

### Requirement: SDK path resolved from settings
The system SHALL use the `androidRunner.sdkPath` VS Code setting as the Android SDK root when it is set to a non-empty string.

#### Scenario: Explicit SDK path configured
- **WHEN** `androidRunner.sdkPath` is set to a non-empty absolute path
- **THEN** the system SHALL use that value as the SDK root for all tool path derivations

### Requirement: SDK path resolved from environment variables
The system SHALL fall back to environment variables when no explicit setting is configured, checking `ANDROID_HOME` before `ANDROID_SDK_ROOT`.

#### Scenario: ANDROID_HOME is set
- **WHEN** `androidRunner.sdkPath` is empty and `ANDROID_HOME` is set
- **THEN** the system SHALL use `ANDROID_HOME` as the SDK root

#### Scenario: ANDROID_SDK_ROOT is set
- **WHEN** `androidRunner.sdkPath` is empty, `ANDROID_HOME` is unset, and `ANDROID_SDK_ROOT` is set
- **THEN** the system SHALL use `ANDROID_SDK_ROOT` as the SDK root

### Requirement: SDK path resolved from OS default
The system SHALL fall back to platform-specific default paths when no setting or environment variable is configured.

#### Scenario: macOS default path
- **WHEN** no SDK setting or env var is configured and the OS is macOS
- **THEN** the system SHALL use `~/Library/Android/sdk` as the SDK root

#### Scenario: Windows default path
- **WHEN** no SDK setting or env var is configured and the OS is Windows
- **THEN** the system SHALL use `%LOCALAPPDATA%/Android/Sdk` as the SDK root

#### Scenario: Linux default path
- **WHEN** no SDK setting or env var is configured and the OS is Linux
- **THEN** the system SHALL use `~/Android/Sdk` as the SDK root

### Requirement: ADB executable path derivation
The system SHALL derive the absolute ADB path from the resolved SDK root.

#### Scenario: ADB path with resolved SDK
- **WHEN** the SDK root is resolved
- **THEN** the system SHALL return `{sdkRoot}/platform-tools/adb` (or `adb.exe` on Windows)

#### Scenario: ADB falls back to system PATH
- **WHEN** the SDK root cannot be resolved
- **THEN** the system SHALL return the string `"adb"` to rely on the system PATH

### Requirement: Emulator executable path derivation
The system SHALL derive the absolute emulator path from the resolved SDK root.

#### Scenario: Emulator path with resolved SDK
- **WHEN** the SDK root is resolved
- **THEN** the system SHALL return `{sdkRoot}/emulator/emulator` (or `emulator.exe` on Windows)

#### Scenario: Emulator falls back to system PATH
- **WHEN** the SDK root cannot be resolved
- **THEN** the system SHALL return the string `"emulator"` to rely on the system PATH

### Requirement: SDK environment variables injected for child processes
The system SHALL inject `ANDROID_SDK_ROOT` and `ANDROID_HOME` into the environment of spawned child processes.

#### Scenario: Environment enriched with SDK paths
- **WHEN** the system spawns a child process that needs the SDK (e.g., `emulator`)
- **THEN** the process environment SHALL include both `ANDROID_SDK_ROOT` and `ANDROID_HOME` set to the resolved SDK root
