extends CharacterBody2D

const SPEED: float = 200.0
const JUMP_VELOCITY: float = -400.0
const GRAVITY: float = 980.0

@export var max_jump_count: int = 2

var jump_count: int = 0

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y += GRAVITY * delta
	else:
		jump_count = 0

	if Input.is_action_just_pressed("ui_accept"):
		jump()

	var direction: float = Input.get_axis("ui_left", "ui_right")
	velocity.x = direction * SPEED

	move_and_slide()

func jump() -> void:
	if jump_count < max_jump_count:
		velocity.y = JUMP_VELOCITY
		jump_count += 1
