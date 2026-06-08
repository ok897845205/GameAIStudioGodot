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
```powershell
& "e:\Godot_v462_stable_win64\Godot_v4.6.2-stable_win64_console.exe" --headless --path . --import
& "e:\Godot_v462_stable_win64\Godot_v4.6.2-stable_win64_console.exe" --headless --path . -s addons/gut/gut_cmdln.gd -gdir=res://tests -gexit
```
