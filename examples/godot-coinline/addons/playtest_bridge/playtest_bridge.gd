extends Node
## Playtest Lab bridge for Godot 4 (protocol "playtest-bridge/1"). Add as an autoload named PlaytestBridge.
##
## Inactive unless the game is started with the user argument `--playtestPort=<port>`
## (e.g. `godot --headless --fixed-fps 60 --path . -- --playtestPort=7777`).
## While active, the scene tree is paused between commands, so the game only advances when the lab asks
## for frames; with `--fixed-fps` every frame has the same delta, making runs deterministic per seed.
##
## Game side: put ONE node in the group "playtest_target" with these methods:
##   reset_game(seed: int) -> void        start a fresh session (skip menus); seed all randomness from it
##   apply_action(action: Dictionary) -> void
##   observe() -> Dictionary               what a player could know
##   is_done() -> bool
##   metrics() -> Dictionary               flat numbers, aggregated across runs
##   is_ready() -> bool                    optional; false while loading
##   check_invariants() -> Array           optional; rules that must always hold. Return [] when fine, else
##                                         Strings or {"id": .., "message": .., "severity": "P0".."P3"}.
##                                         Checked after every reset/step; the lab stops the run and saves a trace.

const PROTOCOL := "playtest-bridge/1"
const TARGET_GROUP := "playtest_target"
const RESET_FRAME_LIMIT := 1200

var _server: TCPServer = null
var _peer: StreamPeerTCP = null
var _buffer := ""
var _frames_left := 0
var _waiting_reset := false
var _reset_frames := 0
var _active := false


func _ready() -> void:
	var port := _read_port()
	if port <= 0:
		set_process(false)
		return
	_active = true
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = 1000  # run after the game's own _process
	_server = TCPServer.new()
	var err := _server.listen(port, "127.0.0.1")
	if err != OK:
		push_error("[PlaytestBridge] cannot listen on %d: %s" % [port, error_string(err)])
		return
	get_tree().paused = true
	print("[PlaytestBridge] listening on 127.0.0.1:%d" % port)


func _process(_delta: float) -> void:
	if not _active:
		return
	if _peer == null and _server.is_connection_available():
		_peer = _server.take_connection()
	if _peer == null:
		return
	_peer.poll()
	if _peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		get_tree().quit()
		return

	if _frames_left > 0:
		_frames_left -= 1
		if _frames_left > 0:
			return
		get_tree().paused = true
		_reply_state()

	if _waiting_reset:
		var t := _target()
		var target_ready := t != null and (not t.has_method("is_ready") or bool(t.call("is_ready")))
		if not target_ready:
			_reset_frames += 1
			if _reset_frames < RESET_FRAME_LIMIT:
				return
			_waiting_reset = false
			get_tree().paused = true
			_send({"ok": false, "error": "reset timed out: no ready node in group '%s'" % TARGET_GROUP})
		else:
			_waiting_reset = false
			get_tree().paused = true
			_reply_state()

	# Idle: handle queued commands until one needs frames.
	var available := _peer.get_available_bytes()
	if available > 0:
		_buffer += _peer.get_utf8_string(available)
	while _buffer.find("\n") >= 0:
		var i := _buffer.find("\n")
		var line := _buffer.substr(0, i).strip_edges()
		_buffer = _buffer.substr(i + 1)
		if line.is_empty():
			continue
		if _handle(line):
			return
	OS.delay_msec(1)  # paused and idle: don't spin a core


func _handle(line: String) -> bool:
	var msg: Variant = JSON.parse_string(line)
	if typeof(msg) != TYPE_DICTIONARY:
		_send({"ok": false, "error": "bad request"})
		return false
	var cmd := str(msg.get("cmd", ""))
	match cmd:
		"hello":
			_send({"ok": true, "protocol": PROTOCOL, "game": ProjectSettings.get_setting("application/config/name", ""), "engine": "godot %s" % Engine.get_version_info().string})
			return false
		"reset":
			var t := _target()
			if t == null:
				_send({"ok": false, "error": "no node in group '%s'" % TARGET_GROUP})
				return false
			t.call("reset_game", int(msg.get("seed", 0)))
			_waiting_reset = true
			_reset_frames = 0
			get_tree().paused = false
			return true
		"step":
			var t := _target()
			if t == null:
				_send({"ok": false, "error": "no node in group '%s'" % TARGET_GROUP})
				return false
			var action: Variant = JSON.parse_string(str(msg.get("action", "{}")))
			t.call("apply_action", action if typeof(action) == TYPE_DICTIONARY else {})
			_frames_left = maxi(1, int(msg.get("n", 1)))
			get_tree().paused = false
			return true
		"metrics":
			var t := _target()
			_send({"ok": true, "metrics": t.call("metrics") if t != null else {}})
			return false
		"screenshot":
			_capture(str(msg.get("path", "")), float(msg.get("scale", 1.0)))
			return true
		"quit":
			_send({"ok": true})
			get_tree().quit()
			return true
		_:
			_send({"ok": false, "error": "unknown cmd '%s'" % cmd})
			return false


func _capture(path: String, scale: float) -> void:
	if path.is_empty() or DisplayServer.get_name() == "headless":
		_send({"ok": false, "error": "screenshot needs a path and a window (not --headless)"})
		return
	get_tree().paused = false
	await RenderingServer.frame_post_draw
	get_tree().paused = true
	var image := get_viewport().get_texture().get_image()
	if scale < 0.999:
		image.resize(maxi(1, int(image.get_width() * scale)), maxi(1, int(image.get_height() * scale)))
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var err := image.save_png(path)
	_send({"ok": err == OK, "path": ProjectSettings.globalize_path(path), "error": error_string(err) if err != OK else ""})


func _reply_state() -> void:
	var t := _target()
	if t == null:
		_send({"ok": false, "error": "target disappeared"})
		return
	var reply := {"ok": true, "done": bool(t.call("is_done")), "obs": t.call("observe")}
	if t.has_method("check_invariants"):
		var violations: Variant = t.call("check_invariants")
		if violations is Array and not violations.is_empty():
			reply["violations"] = violations
	_send(reply)


func _target() -> Node:
	return get_tree().get_first_node_in_group(TARGET_GROUP)


func _send(payload: Dictionary) -> void:
	if _peer != null:
		_peer.put_data((JSON.stringify(payload) + "\n").to_utf8_buffer())


func _read_port() -> int:
	var args := OS.get_cmdline_user_args() + OS.get_cmdline_args()
	for i in args.size():
		var a := str(args[i])
		if a.begins_with("--playtestPort="):
			return int(a.get_slice("=", 1))
		if (a == "--playtestPort" or a == "-playtestPort") and i + 1 < args.size():
			return int(args[i + 1])
	return int(OS.get_environment("PLAYTEST_PORT")) if OS.has_environment("PLAYTEST_PORT") else 0
