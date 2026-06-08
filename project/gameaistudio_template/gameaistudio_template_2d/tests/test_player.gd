extends GutTest

var player_scene: PackedScene = preload("res://scenes/main.tscn")
var player: CharacterBody2D

func before_each() -> void:
	player = CharacterBody2D.new()
	player.set_script(load("res://scripts/player.gd"))
	add_child_autofree(player)

func test_initial_jump_count_is_zero() -> void:
	assert_eq(player.jump_count, 0, "Initial jump count should be 0.")

func test_max_jump_count_default() -> void:
	assert_eq(player.max_jump_count, 2, "Default max jump count should be 2.")

func test_jump_increments_count() -> void:
	player.jump_count = 0
	player.jump()
	assert_eq(player.jump_count, 1, "Jump should increment the counter.")

func test_jump_respects_max_count() -> void:
	player.jump_count = 2
	var velocity_before: float = player.velocity.y
	player.jump()
	assert_eq(player.velocity.y, velocity_before, "Jump should not change velocity after the max count.")
