## Context

The Android Runner sidebar (`src/androidView.ts`) renders an "Emulators" folder with one `TreeItem` per configured AVD. Currently none of those items carry a `command` property, so clicking or double-clicking them does nothing. The emulator lifecycle is already fully implemented in `src/emulator.ts` (`startEmulator()`), and the SDK path resolution is in `src/sdk.ts`. The only missing piece is wiring a VS Code command to the tree item.

## Goals / Non-Goals

**Goals:**
- Register a new `androidRunner.startEmulator` command that accepts an AVD name and launches it.
- Attach that command to non-running emulator `TreeItem`s so a double-click triggers it.
- Keep running emulator items inert on click (already running, no action needed).

**Non-Goals:**
- Auto-refreshing the sidebar after launch (user uses the existing Refresh button).
- Killing or restarting a running emulator from a click.
- Selecting an emulator as the default target for run commands.

## Decisions

### Command registered in `extension.ts`, called from `androidView.ts`

**Decision**: Register `androidRunner.startEmulator` inside `activate()` in `extension.ts`, and assign it as the `command` on non-running emulator `TreeItem`s in `androidView.ts`.

**Alternatives considered**:
- Register the command inside `registerAndroidView()` — cohesive but breaks the pattern: all other commands live in `extension.ts`. Keeping them there makes the command palette consistent.

**Rationale**: Follows the existing convention — every `androidRunner.*` command is registered in `extension.ts`. The tree item just references the command ID.

### Re-use `startEmulator()` from `emulator.ts` directly

**Decision**: The new command calls `startEmulator(avdName, sdkPath)` directly (same function used by the run flow).

**Rationale**: The function already handles the detached spawn pattern. No duplication needed.

### No click handler for running emulators

**Decision**: When `element.running === true`, omit the `command` property from the `TreeItem`.

**Rationale**: Clicking a running emulator has no meaningful action. Assigning a no-op command would mislead users into thinking something happened. Omitting `command` keeps the item visually inert.

## Risks / Trade-offs

- [Risk] User double-clicks while an emulator is already starting → Mitigation: `startEmulator()` is a detached fire-and-forget process; a second start of the same AVD will fail gracefully (the emulator binary rejects duplicate AVDs with an error message — no data loss).
- [Risk] SDK path not configured → Mitigation: `startEmulator()` already resolves the SDK via `sdk.ts` and surfaces errors to the output channel; no additional handling needed here.
