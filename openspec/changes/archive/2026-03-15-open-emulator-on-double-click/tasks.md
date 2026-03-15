## 1. Register the new command

- [x] 1.1 In `package.json`, add `androidRunner.startEmulator` to `contributes.commands` with title "Android: Start Emulator"
- [x] 1.2 In `src/extension.ts`, register `androidRunner.startEmulator` command inside `activate()` that accepts an AVD name string and calls `startEmulator(avdName, sdkPath)` from `src/emulator.ts`

## 2. Wire the command to the sidebar tree items

- [x] 2.1 In `src/androidView.ts`, update the `getTreeItem()` handler for `element.kind === "emulator"`: when `element.running === false`, set `item.command` to invoke `androidRunner.startEmulator` with `element.name` as argument
- [x] 2.2 Confirm that when `element.running === true`, no `command` property is set on the `TreeItem` (item remains inert on click)
