@tool
extends EditorPlugin
## Registers the PlaytestBridge autoload when the plugin is enabled.

const AUTOLOAD_NAME := "PlaytestBridge"


func _enter_tree() -> void:
	add_autoload_singleton(AUTOLOAD_NAME, "res://addons/playtest_bridge/playtest_bridge.gd")


func _exit_tree() -> void:
	remove_autoload_singleton(AUTOLOAD_NAME)
