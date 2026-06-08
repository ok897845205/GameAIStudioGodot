extends SceneTree

var _failures: int = 0

func _init() -> void:
	var test_dir := _get_arg_value("-gdir", "res://tests")
	print("[GutMinimal] Running tests in %s" % test_dir)
	_run_dir(test_dir)
	print("[GutMinimal] Failures: %d" % _failures)
	quit(1 if _failures > 0 else 0)

func _get_arg_value(prefix: String, default_value: String) -> String:
	for arg in OS.get_cmdline_args():
		if arg.begins_with(prefix + "="):
			return arg.substr(prefix.length() + 1)
	return default_value

func _run_dir(path: String) -> void:
	var dir := DirAccess.open(path)
	if dir == null:
		printerr("[GutMinimal] Could not open %s" % path)
		_failures += 1
		return

	for file_name in dir.get_files():
		if file_name.ends_with(".gd"):
			_run_script(path.path_join(file_name))

func _run_script(path: String) -> void:
	var script := load(path)
	if script == null:
		printerr("[GutMinimal] Could not load %s" % path)
		_failures += 1
		return

	var instance: Node = script.new()
	root.add_child(instance)
	for method in instance.get_method_list():
		var method_name: String = method.name
		if method_name.begins_with("test_"):
			if instance.has_method("before_each"):
				instance.before_each()
			if instance.has_method("clear_failures"):
				instance.clear_failures()
			instance.call(method_name)
			if instance.has_method("get_failure_count"):
				_failures += instance.get_failure_count()
	instance.queue_free()
