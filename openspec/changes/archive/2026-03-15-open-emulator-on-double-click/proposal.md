## Why

The "Emulators" folder in the Android Runner sidebar shows a list of configured AVDs but clicking on them does nothing — there is no interaction at all. This is a discoverability gap: users expect list items to be actionable, and there is no other way to start a specific emulator from the sidebar.

## What Changes

- Emulator tree items in the sidebar will become clickable: double-clicking a non-running AVD will start it via `emulator -avd <name>`.
- A new VS Code command `androidRunner.startEmulator` will be registered, accepting an AVD name as argument.
- Running emulators (already active) will not respond to the click to avoid accidental restarts.

## Capabilities

### New Capabilities

- `emulator-launch-from-sidebar`: Ability to start a specific AVD by clicking its entry in the Emulators sidebar section.

### Modified Capabilities

- `sidebar-panel`: The Emulators folder requirement needs a new scenario for the click/launch interaction on non-running AVD items.

## Impact

- `src/androidView.ts` — add `command` to emulator `TreeItem` when the AVD is not running.
- `src/extension.ts` — register the `androidRunner.startEmulator` command.
- `package.json` — declare the new command in `contributes.commands`.

## Non-goals

- Auto-refreshing the sidebar after the emulator starts (user can manually refresh).
- Stopping or killing a running emulator from the sidebar click (separate concern).
- Selecting an emulator as the "target device" for subsequent run commands.
