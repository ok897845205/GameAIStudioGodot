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

	# Load every project script and scene. A .gd with a parse error still
	# loads as a GDScript object (only can_instantiate() turns false), and its
	# scene still instantiates without the script — so checking only the scene
	# tree would let completely broken game code pass validation.
	var script_paths: Array[String] = []
	var scene_paths: Array[String] = []
	_scan_resources("res://", script_paths, scene_paths)
	for script_path in script_paths:
		var script := load(script_path)
		if script == null or (script is GDScript and not (script as GDScript).can_instantiate()):
			errors.append("Script failed to load (parse error): " + script_path)
	for scene_path in scene_paths:
		if load(scene_path) == null:
			errors.append("Scene failed to load: " + scene_path)

	var main_scene := load("res://scenes/main.tscn") as PackedScene
	if main_scene == null:
		errors.append("Could not load res://scenes/main.tscn.")
	else:
		var main := main_scene.instantiate()
		if not main is Node3D:
			errors.append("Main scene root must be Node3D.")
		for node_path in ["Player", "Player/CameraPivot/SpringArm3D/Camera3D", "Ground", "Sun", "BasicObjects/Cube", "BasicObjects/Sphere", "BasicObjects/Cylinder", "Enemy"]:
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


# Collect all game scripts/scenes under res://, skipping engine/addon dirs and
# this CI tool itself, so agent-written code anywhere in the project is checked.
func _scan_resources(dir_path: String, scripts: Array[String], scenes: Array[String]) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if entry.begins_with("."):
			entry = dir.get_next()
			continue
		var full := dir_path.path_join(entry)
		if dir.current_is_dir():
			var skip := dir_path == "res://" and (entry == "addons" or entry == "build" or entry == "dist" or entry == "tools" or entry == "export")
			if not skip:
				_scan_resources(full, scripts, scenes)
		elif entry.ends_with(".gd"):
			scripts.append(full)
		elif entry.ends_with(".tscn"):
			scenes.append(full)
		entry = dir.get_next()
	dir.list_dir_end()
