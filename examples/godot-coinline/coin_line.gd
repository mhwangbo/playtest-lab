extends Node
## Tiny 1D sample game for the Playtest Lab Godot bridge: move along a line, grab coins, dodge a hazard
## that relocates every few seconds. Same rules as the Unity CoinLine sample. A run lasts RUN_SECONDS.

const LINE_LENGTH := 20.0
const MOVE_SPEED := 6.0
const PICKUP_RADIUS := 0.5
const HAZARD_RADIUS := 0.4
const HAZARD_RELOCATE_SECONDS := 5.0
const HAZARD_SAFE_DISTANCE := 3.0
const RUN_SECONDS := 30.0

var _rng := RandomNumberGenerator.new()
var _x: float = LINE_LENGTH / 2.0
var _coin: float = 0.0
var _hazard: float = 0.0
var _hazard_timer: float = 0.0
var _elapsed: float = 0.0
var _move: float = 0.0
var _score: int = 0
var _died: bool = false


func _ready() -> void:
	add_to_group("playtest_target")
	reset_game(1)


func _process(delta: float) -> void:
	if is_done():
		return
	_elapsed += delta
	_x = clampf(_x + _move * MOVE_SPEED * delta, 0.0, LINE_LENGTH)
	if absf(_x - _coin) < PICKUP_RADIUS:
		_score += 1
		_coin = _random_pos()
	_hazard_timer -= delta
	if _hazard_timer <= 0.0:
		_relocate_hazard()
	if absf(_x - _hazard) < HAZARD_RADIUS:
		_died = true


## Starts a fresh run; all randomness comes from [param seed].
func reset_game(seed: int) -> void:
	_rng.seed = seed
	_x = LINE_LENGTH / 2.0
	_elapsed = 0.0
	_score = 0
	_died = false
	_move = 0.0
	_coin = _random_pos()
	_relocate_hazard()


func apply_action(action: Dictionary) -> void:
	_move = clampf(float(action.get("move", 0.0)), -1.0, 1.0)


func observe() -> Dictionary:
	return {"x": _x, "coin": _coin, "hazard": _hazard, "timeLeft": maxf(0.0, RUN_SECONDS - _elapsed), "score": _score}


func is_done() -> bool:
	return _died or _elapsed >= RUN_SECONDS


func is_ready() -> bool:
	return true


## Rules that must always hold; the Playtest Lab bridge reports any broken one as a bug with a replayable trace.
func check_invariants() -> Array:
	var broken: Array = []
	if _x < 0.0 or _x > LINE_LENGTH:
		broken.append({"id": "player-on-line", "message": "player x %.2f is off the line" % _x})
	if _coin < 0.0 or _coin > LINE_LENGTH:
		broken.append({"id": "coin-on-line", "message": "coin at %.2f is off the line" % _coin})
	return broken


func metrics() -> Dictionary:
	return {"score": _score, "died": 1 if _died else 0, "survivedSeconds": _elapsed}


func _random_pos() -> float:
	return _rng.randf() * LINE_LENGTH


func _relocate_hazard() -> void:
	_hazard = _random_pos()
	while absf(_hazard - _x) < HAZARD_SAFE_DISTANCE:
		_hazard = _random_pos()
	_hazard_timer = HAZARD_RELOCATE_SECONDS
