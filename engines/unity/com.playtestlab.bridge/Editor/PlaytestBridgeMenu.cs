using UnityEditor;

namespace PlaytestLab.Editor
{
    /// <summary>Lets you drive Play Mode from Playtest Lab: enable a port, press Play, point the adapter at it.</summary>
    internal static class PlaytestBridgeMenu
    {
        private const string Key = "PlaytestLab.BridgePort";
        private const int DefaultPort = 7777;

        [MenuItem("Tools/Playtest Lab/Enable Bridge In Play Mode (port 7777)")]
        private static void Enable() => EditorPrefs.SetInt(Key, DefaultPort);

        [MenuItem("Tools/Playtest Lab/Enable Bridge In Play Mode (port 7777)", true)]
        private static bool EnableValidate() => EditorPrefs.GetInt(Key, 0) == 0;

        [MenuItem("Tools/Playtest Lab/Disable Bridge In Play Mode")]
        private static void Disable() => EditorPrefs.DeleteKey(Key);

        [MenuItem("Tools/Playtest Lab/Disable Bridge In Play Mode", true)]
        private static bool DisableValidate() => EditorPrefs.GetInt(Key, 0) != 0;
    }
}
