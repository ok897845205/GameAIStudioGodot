class_name GutTest
extends Node

var _watched_signals: Dictionary = {}
var _failure_count: int = 0

func add_child_autofree(node: Node) -> Node:
	add_child(node)
	return node

func assert_eq(actual: Variant, expected: Variant, message: String = "") -> void:
	if actual != expected:
		_failure_count += 1
		push_error(_format_assertion("assert_eq", actual, expected, message))

func watch_signals(object: Object) -> void:
	_watched_signals[object] = {}
	for signal_info in object.get_signal_list():
		var signal_name: StringName = signal_info.name
		_watched_signals[object][signal_name] = false
		var arg_count: int = signal_info.args.size()
		if arg_count == 0:
			object.connect(signal_name, Callable(self, "_on_watched_signal_0").bind(object, signal_name))
		elif arg_count == 1:
			object.connect(signal_name, Callable(self, "_on_watched_signal_1").bind(object, signal_name))
		else:
			object.connect(signal_name, Callable(self, "_on_watched_signal_2").bind(object, signal_name))

func assert_signal_emitted(object: Object, signal_name: String, message: String = "") -> void:
	var emitted: bool = _watched_signals.get(object, {}).get(StringName(signal_name), false)
	if not emitted:
		_failure_count += 1
		push_error(message if message != "" else "Expected signal '%s' to be emitted." % signal_name)

func clear_failures() -> void:
	_failure_count = 0

func get_failure_count() -> int:
	return _failure_count

func _on_watched_signal_0(object: Object, signal_name: StringName) -> void:
	_mark_signal_emitted(object, signal_name)

func _on_watched_signal_1(_value: Variant, object: Object, signal_name: StringName) -> void:
	_mark_signal_emitted(object, signal_name)

func _on_watched_signal_2(_value_a: Variant, _value_b: Variant, object: Object, signal_name: StringName) -> void:
	_mark_signal_emitted(object, signal_name)

func _mark_signal_emitted(object: Object, signal_name: StringName) -> void:
	if _watched_signals.has(object):
		_watched_signals[object][signal_name] = true

func _format_assertion(kind: String, actual: Variant, expected: Variant, message: String) -> String:
	var prefix := "%s failed. Expected: %s Actual: %s" % [kind, str(expected), str(actual)]
	return prefix if message == "" else "%s - %s" % [prefix, message]
