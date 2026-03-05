# Android Runner

Android Runner is a VSCode/Cursor extension that simplifies running Android builds and streaming logs.

## Features

- Start an Android emulator
- Install a selected Gradle build variant
- Automatically launch the app
- Stream logcat filtered by app PID
- Stop logs from the command palette
- Kill the running emulator

## Commands

- Android Runner: Run & Logs
- Android Runner: Run Staging
- Android Runner: Logs
- Android Runner: Stop Logs
- Android Runner: Kill Emulator

## Requirements

- Android SDK installed
- adb available in PATH
- Gradle wrapper (`gradlew`) in the project

## Extension Settings

Example configuration:

```json
{
  "androidRunner.defaultAvd": "Pixel_9_API34",
  "androidRunner.keepEmulator": false,
  "androidRunner.taskAppIds": {
    "installStaging": "com.altwo.wallet.staging"
  }
}