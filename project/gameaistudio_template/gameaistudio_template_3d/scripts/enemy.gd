extends CharacterBody3D

const SPEED: float = 2.0
const GRAVITY: float = 24.0

@export var patrol_distance: float = 4.0

var direction: float = 1.0
var start_position: Vector3

func _ready() -> void:
	start_position = global_position

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y += GRAVITY * delta

	velocity.x = direction * SPEED

	if abs(global_position.x - start_position.x) >= patrol_distance:
		direction *= -1.0
		rotation.y += PI

	move_and_slide()
