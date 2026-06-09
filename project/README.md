# GameAIStudio Desktop

This folder contains the newly written desktop app for GameAIStudio, an AI-assisted game creation platform that creates Godot projects, runs local AI CLI agents, previews Web exports, and packages playable Web zip builds.

## Commands

```powershell
pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm smoke:templates
pnpm smoke:webzip
pnpm dist:win
pnpm verify:release
```

`pnpm verify:release` is the release gate. It runs type checks, tests, the Web zip smoke path, and Windows installer packaging.

## Runtime Paths

- Built-in Godot engine: `engine/`
- Built-in templates: `gameaistudio_template/`
- User projects: `%USERPROFILE%\Documents\GameAIStudio\projects`
- Studio state: `%USERPROFILE%\Documents\GameAIStudio\studio-state.json`

Set `GAMEAISTUDIO_HOME` to override the user data folder during development.
Set `GAMEAISTUDIO_RESOURCE_ROOT` to point at a folder containing `engine/` and `gameaistudio_template/` when testing resource resolution.

## Release Packaging

Desktop packages built with `pnpm dist:win` produce a named NSIS installer at `dist/GameAIStudio-Setup-<version>.exe`, use the generated GameAIStudio app icon, copy `engine/` and a clean `gameaistudio_template/` into Electron `resources/`, and exclude stale `.godot`, `build`, and `dist` output.
`pnpm smoke:templates` copies the bundled 2D/3D templates with the same clean rules used by the app, validates them with the bundled Godot console, and verifies Web export files.
`pnpm smoke:webzip` extends that path through export manifest generation and Web zip packaging for both 2D and 3D.

## Current App Capabilities

- Creates 2D or 3D Godot projects from the bundled templates, with an optional default-on flow that immediately starts the team workflow.
- Copies clean Godot template source into new projects while excluding generated `.godot`, `build`, and `dist` artifacts from previous template runs.
- Validates the selected template's `project.godot` and Web export preset before copying it into a user project.
- Shows create-and-generate preflight checks for local AI CLI availability, selected Godot template availability, and Web preview/export readiness.
- Shows system environment health for Git and Node.js, with refreshable diagnostics and clear missing-tool actions.
- Shows bundled Godot runtime health for the engine directory, GUI/console executables, version probe, and 2D/3D templates including their Web export presets.
- Opens the current project in the bundled Godot GUI executable from the desktop UI.
- Detects Codex, Claude, KSCC, and Kimi from the system PATH.
- Shows local CLI health diagnostics for command discovery, install manager availability, npm global PATH hints, and common credential environment variables, and uses the discovered install-manager executable for one-click CLI installs.
- Runs a selected local CLI as a role-based Agent inside the project folder.
- Prepares `.gameaistudio/agent-context.md` before each Agent turn with the project file map, recent conversation, role context, delivery status, and response contract; Agent CLI prompts reference this file instead of inlining the full context into command-line arguments.
- Appends `.gameaistudio/agent-journal.md` after Agent turns and injects its recent tail into the next Agent context so producer, designer, programmer, artist, and QA can hand off through project-local state.
- Initializes `GAMEAISTUDIO.md`, `.gameaistudio/agent-context.md`, and `.gameaistudio/agent-journal.md` when a project is created, with desktop quick actions that preview them inside a second modal from the active project status panel.
- Supports in-app preview for text files, images, changed files, and Agent image attachments while keeping preview paths confined to the selected project directory.
- Reports desktop open-path failures in the UI instead of silently ignoring missing zip, manifest, Agent context, or journal files.
- Keeps `.gameaistudio/project.json` in the generated Godot project synchronized with the latest preview/export metadata without overwriting `GAMEAISTUDIO.md` Agent notes.
- Runs a five-role team workflow: producer, designer, programmer, artist, and QA, routing each role to its default local CLI when available, previewing that routing before creation/build actions, falling back to installed tools when needed, then exporting Web, inspecting the Web build artifacts, packaging Web zip, and refreshing preview.
- Appends a persistent system summary after each team workflow so the conversation shows export, artifact inspection, zip, preview, and next-step status.
- Persists Agent run records, streams run state/output changes into the desktop UI, and can cancel active local CLI runs.
- Provides a Codex-style project chat with image attachments; attached images are saved into the project and referenced in the local AI CLI prompt so vision-capable CLIs can use them as part of the request.
- Captures per-Agent Godot project file changes and shows them in both the conversation and run timeline.
- Uses Git for project version management when available: new projects are initialized with a project `.gitignore` and initial commit, existing projects can enable Git, inspect branch/head/changed files, view up to five recent commits, commit versions, and restore any valid commit hash from the right-side Git panel.
- Deletes created game projects from the desktop UI with a confirmation warning that the generated local Godot directory is removed too.
- Watches Godot project files and refreshes the Web preview after source or asset changes.
- Reloads the embedded preview frame after preview events and serves preview files with no-cache headers to reduce stale Web builds during iteration.
- Keeps local preview HTTP requests confined to the generated Web build directory.
- Fails preview startup with a clear message when the Web build folder or `index.html` is missing.
- Can automatically start or refresh the Web preview after a single Agent turn changes preview-relevant Godot files.
- Reports initial auto-preview export failures instead of starting a stale or missing preview build.
- Exports Web zip through a validation -> Godot Web export -> Web artifact inspection -> zip pipeline with visible run steps.
- Uses Windows-safe sanitized filenames for exported Web zip files so ordinary project names with punctuation can still be packaged.
- Shows the latest Web zip as a build deliverable with quick actions to open the zip, export folder, or `gameaistudio-export.json` manifest included in each zip.
- Persists and displays the latest Web build artifact inspection so users can see whether the export has the required HTML, wasm, and pck files.
- Serves `build/web/index.html` through a local preview server.
- Runs Godot Web export and packages `build/web` into a zip.
