extends SceneTree

func _init() -> void:
	print("[GameAIStudio] Starting project validation...")

	var errors: Array[String] = []
	var required_files: Array[String] = [
		"res://project.godot",
		"res://export_presets.cfg",
		"res://scenes/main.tscn",
		"res://scenes/ui/hud.tscn",
		"res://scenes/levels/level_01.tscn",
		"res://scripts/player.gd",
		"res://scripts/enemy.gd",
		"res://scripts/game_manager.gd",
		"res://addons/gut/plugin.cfg",
		"res://addons/gut/gut_test.gd",
		"res://addons/gut/gut_cmdln.gd",
	]

	for path in required_files:
		if not FileAccess.file_exists(path):
			errors.append("Missing required file: " + path)

	if not ProjectSettings.has_setting("autoload/GameManager"):
		errors.append("Missing GameManager autoload.")

	var renderer: String = str(ProjectSettings.get_setting("rendering/renderer/rendering_method", ""))
	if renderer != "gl_compatibility":
		errors.append("Renderer must be gl_compatibility, got: " + renderer)

	var main_scene := load("res://scenes/main.tscn") as PackedScene
	if main_scene == null:
		errors.append("Could not load res://scenes/main.tscn.")
	else:
		var main := main_scene.instantiate()
		if not main is Node3D:
			errors.append("Main scene root must be Node3D.")
		for node_path in ["Player", "Player/Camera3D", "Ground", "Sun", "BasicObjects/Cube", "BasicObjects/Sphere", "BasicObjects/Cylinder", "Enemy"]:
			if main.get_node_or_null(NodePath(node_path)) == null:
				errors.append("Main scene missing node: " + node_path)
		main.free()

	if errors.is_empty():
		print("[GameAIStudio] Validation passed.")
		quit(0)
	else:
		for err in errors:
			printerr("[GameAIStudio] Error: " + err)
		quit(1)
