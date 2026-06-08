extends Node

signal game_started
signal game_over(score: int)

var score: int = 0
var is_game_running: bool = false

func start_game() -> void:
	score = 0
	is_game_running = true
	game_started.emit()

func add_score(points: int) -> void:
	score += points

func end_game() -> void:
	is_game_running = false
	game_over.emit(score)
