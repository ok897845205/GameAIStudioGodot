extends CharacterBody2D

const SPEED: float = 80.0
const GRAVITY: float = 980.0

@export var patrol_distance: float = 100.0

var direction: float = 1.0
var start_position: Vector2

func _ready() -> void:
	start_position = global_position

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y += GRAVITY * delta

	velocity.x = direction * SPEED

	if abs(global_position.x - start_position.x) >= patrol_distance:
		direction *= -1.0

	move_and_slide()
