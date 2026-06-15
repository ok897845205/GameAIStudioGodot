# GameAIStudio Template 3D - AI Agent Guide

## Project Layout
- Entry scene: `res://scenes/main.tscn`
- Player script: `res://scripts/player.gd` using `CharacterBody3D`
- Game state: `res://scripts/game_manager.gd` as the `GameManager` autoload
- Tests: `res://tests/` using the bundled minimal GUT-compatible skeleton
- Validation script: `res://tools/ci/validate_project.gd`

## Godot 4 API Rules
- Set the built-in 3D `velocity`, then call parameterless `move_and_slide()`.
- Use `await some_signal`, not `yield`.
- Use `@export var health: int`, not `export var`.
- Declare signals as `signal game_over(score: int)` and emit with `.emit()`.

## Forbidden Godot 3 Patterns
- `move_and_slide(velocity, Vector2.UP)`
- `velocity = move_and_slide(...)`
- `yield(get_tree(), "idle_frame")`

## Validation
GameAIStudio runs Godot for you after each round — headless `--import`, the
project validation script (`res://tools/ci/validate_project.gd`), GUT tests,
and the Web export. Do **not** invoke Godot yourself: the console binary is
bundled inside the app, not on PATH, and its location differs per machine, so
hardcoded paths will fail. Focus on writing correct GDScript per the API rules
above; the workflow's "Godot 可运行校验" and "Web 导出" steps surface any
parse/runtime errors for the next round to fix.
