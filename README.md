# GameAIStudio

GameAIStudio is a newly written desktop AI game creation platform for ordinary users. A user chooses 2D or 3D, describes a game idea in one sentence, and the app creates a Godot project from bundled templates, coordinates local AI CLI agents, previews the Web build, and packages the result as a Web zip.

The desktop application lives in `project/`.

## Quick Start

```powershell
cd project
pnpm install
pnpm dev
```

## Current MVP

- Electron, Vite, and React desktop shell for Windows.
- Built-in Godot 2D and 3D templates copied into the user's GameAIStudio workspace.
- Bundled Godot runtime diagnostics, project opening, Web export, preview, and zip packaging.
- Git and Node.js environment diagnostics surfaced in the desktop UI.
- Local CLI discovery and install diagnostics for Codex, Claude, KSCC, and Kimi.
- Producer, designer, programmer, artist, and QA agent workflow with Codex-style chat, image attachments, streaming output, cancellation, and file change summaries.
- Project Git version management: new projects try to initialize a repository automatically, the UI shows up to five recent commits, and users can commit or restore any valid commit hash.
- In-app file preview for project notes, Agent context, Agent logs, changed files, and image attachments.
- Project deletion with confirmation that also removes the local generated Godot directory.
- Project-local AI context files: `GAMEAISTUDIO.md`, `.gameaistudio/agent-context.md`, and `.gameaistudio/agent-journal.md`.
- Web export inspection, `gameaistudio-export.json` manifest generation, and Windows-safe Web zip names.

## Release Gate

```powershell
cd project
pnpm verify:release
```

The release gate runs type checks, tests, 2D/3D Web zip smoke tests, and Windows installer packaging. A successful Windows build produces `project/dist/GameAIStudio-Setup-<version>.exe`.

## Reference Projects

Older experiments at `E:\AIProject\GameAIStudio` and `E:\AIProject\GameAIStudioCLI` are reference material only. This repository is being implemented as a fresh codebase rather than copying those projects wholesale.
