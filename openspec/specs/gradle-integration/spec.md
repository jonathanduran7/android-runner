## Purpose
Defines how the extension discovers Gradle install tasks, executes Gradle builds, resolves application IDs from task mappings or `build.gradle`, and supports configurable Gradle root paths.

## Requirements

### Requirement: Gradle install task discovery
The system SHALL enumerate available install tasks by running `./gradlew :app:tasks --all` and filtering for `installXxx` patterns, excluding test variants.

#### Scenario: Install tasks discovered
- **WHEN** a valid Android Gradle project is open
- **THEN** the system SHALL return a sorted list of task strings in `:app:installXxx` format (e.g., `:app:installDebug`, `:app:installStaging`)

#### Scenario: Test variants excluded
- **WHEN** Gradle tasks include `AndroidTest` or `UnitTest` variants
- **THEN** the system SHALL exclude those from the returned list

#### Scenario: No install tasks found
- **WHEN** the Gradle project has no `installXxx` tasks
- **THEN** the system SHALL return an empty list

### Requirement: Gradle install execution
The system SHALL run the selected Gradle install task by spawning `./gradlew <task>` and streaming its output to the Android Runner output channel.

#### Scenario: Successful Gradle install
- **WHEN** `./gradlew <task>` exits with code 0
- **THEN** the system SHALL resolve successfully and the APK SHALL be installed on the target device

#### Scenario: Gradle install failure
- **WHEN** `./gradlew <task>` exits with a non-zero exit code
- **THEN** the system SHALL reject with an error and abort the run flow

#### Scenario: Gradle output streamed in real time
- **WHEN** Gradle is running
- **THEN** both stdout and stderr SHALL be written line-by-line to the Android Runner VS Code output channel

### Requirement: Application ID detection from task mapping
The system SHALL resolve the app's `applicationId` for a given Gradle task using the `androidRunner.taskAppIds` setting.

#### Scenario: App ID found in task mapping
- **WHEN** the selected task suffix (e.g., `installStaging`) has an entry in `androidRunner.taskAppIds`
- **THEN** the system SHALL use the configured package name (e.g., `com.example.app.staging`) for PID resolution and logcat filtering

#### Scenario: App ID not configured
- **WHEN** no entry exists in `taskAppIds` for the selected task
- **THEN** the system SHALL proceed without PID filtering (unfiltered logcat) and SHALL display a warning notification

### Requirement: Application ID detection from build.gradle
The system SHALL attempt to parse the `applicationId` from `app/build.gradle` when it is not configured in `taskAppIds`.

#### Scenario: Default applicationId parsed
- **WHEN** `app/build.gradle` contains `applicationId "<value>"` in `defaultConfig`
- **THEN** the system SHALL return that value as the base application ID

#### Scenario: Flavor-specific applicationId resolved
- **WHEN** a product flavor or build type defines an `applicationIdSuffix` or overrides `applicationId`
- **THEN** the system SHALL resolve the compound ID (e.g., `com.example.app` + `.staging`) for the matching task suffix

#### Scenario: Build file not found
- **WHEN** `app/build.gradle` does not exist at the expected path
- **THEN** the system SHALL return `null` without throwing

### Requirement: Gradle root path configuration
The system SHALL support a configurable `androidRunner.gradleRoot` setting to locate `gradlew` in a subdirectory of the workspace.

#### Scenario: Gradle root configured
- **WHEN** `androidRunner.gradleRoot` is set to a relative path (e.g., `android/`)
- **THEN** the system SHALL look for `gradlew` in `{workspaceRoot}/{gradleRoot}` instead of the workspace root

#### Scenario: Gradle root defaults to workspace root
- **WHEN** `androidRunner.gradleRoot` is empty
- **THEN** the system SHALL use the workspace root folder as the Gradle project directory
