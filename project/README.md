# GameAIStudio Desktop

This folder contains the newly written desktop app for GameAIStudio.

## Commands

```powershell
pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm build
```

## Runtime Paths

- Built-in Godot engine: `engine/`
- Built-in templates: `gameaistudio_template/`
- User projects: `%USERPROFILE%\Documents\GameAIStudio\projects`
- Studio state: `%USERPROFILE%\Documents\GameAIStudio\studio-state.json`

Set `GAMEAISTUDIO_HOME` to override the user data folder during development.

## First Slice

- Creates 2D or 3D Godot projects from the bundled templates, with an optional default-on flow that immediately starts the team workflow.
- Shows bundled Godot runtime health for the engine directory, GUI/console executables, version probe, and 2D/3D templates.
- Detects Codex, Claude, KSCC, and Kimi from the system PATH.
- Shows local CLI health diagnostics for command discovery, install manager availability, and common credential environment variables.
- Runs a selected local CLI as a role-based Agent inside the project folder.
- Prepares `.gameaistudio/agent-context.md` before each Agent turn with the project file map, recent conversation, role context, and response contract.
- Runs a five-role team workflow: producer, designer, programmer, artist, and QA, then can export Web and refresh the preview.
- Persists Agent run records, streams run state/output changes into the desktop UI, and can cancel active local CLI runs.
- Captures per-Agent Godot project file changes so users can see which scripts, scenes, and assets were added, modified, or deleted.
- Creates project version snapshots before/after Agent work and supports restoring a previous snapshot with a safety snapshot first.
- Watches Godot project files and refreshes the Web preview after source or asset changes.
- Exports Web zip through a validation -> Godot Web export -> zip pipeline with visible run steps.
- Serves `build/web/index.html` through a local preview server.
- Runs Godot Web export and packages `build/web` into a zip.
