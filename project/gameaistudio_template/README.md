# GameAIStudio Godot Templates

This directory contains two independent Godot 4.6.2 starter projects:

- `gameaistudio_template_2d/` - 2D starter project with a `Node2D` main scene, player, ground, HUD, level scene, Web export preset, and Windows Desktop export preset.
- `gameaistudio_template_3d/` - 3D starter project with a `Node3D` main scene, player, camera, light, ground, platform, basic mesh objects, enemy, Web export preset, and Windows Desktop export preset.

Run validation from each project directory:

```powershell
& "e:\Godot_v462_stable_win64\Godot_v4.6.2-stable_win64_console.exe" --headless --path . --import
& "e:\Godot_v462_stable_win64\Godot_v4.6.2-stable_win64_console.exe" --headless --path . -s tools/ci/validate_project.gd
& "e:\Godot_v462_stable_win64\Godot_v4.6.2-stable_win64_console.exe" --headless --path . -s addons/gut/gut_cmdln.gd -gdir=res://tests -gexit
```
