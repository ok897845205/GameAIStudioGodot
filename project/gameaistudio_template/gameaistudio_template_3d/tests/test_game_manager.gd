extends GutTest

var gm: Node

func before_each() -> void:
	gm = Node.new()
	gm.set_script(load("res://scripts/game_manager.gd"))
	add_child_autofree(gm)

func test_initial_score_is_zero() -> void:
	assert_eq(gm.score, 0, "Initial score should be 0.")

func test_add_score() -> void:
	gm.start_game()
	gm.add_score(10)
	assert_eq(gm.score, 10, "add_score should increase score.")

func test_game_over_emits_signal() -> void:
	gm.start_game()
	watch_signals(gm)
	gm.end_game()
	assert_signal_emitted(gm, "game_over")
