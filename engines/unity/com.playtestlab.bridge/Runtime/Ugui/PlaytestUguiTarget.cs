using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace PlaytestLab
{
    /// <summary>
    /// Zero-code persona target for games whose UI is built with Unity UI (uGUI): launch the build with
    /// <c>-playtestPort &lt;port&gt; -playtestUgui</c> and personas can read visible text and buttons and tap them.
    /// For richer perception (board state, names, hints) subclass it or write your own <see cref="IPlaytestTarget"/>
    /// and use <see cref="Ugui"/> helpers.
    /// Actions (JSON): {"tap":"Play"} button by label · {"tapAt":[x,y]} normalized screen point (0..1, top-left origin).
    /// </summary>
    public class PlaytestUguiTarget : MonoBehaviour, IPlaytestTarget
    {
        [Serializable]
        protected class UguiAction
        {
            public string tap = "";
            public float[] tapAt;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Bootstrap()
        {
            var args = Environment.GetCommandLineArgs();
            if (Array.IndexOf(args, "-playtestUgui") < 0 || Array.IndexOf(args, "-playtestPort") < 0) return;
            var go = new GameObject("PlaytestUguiTarget");
            DontDestroyOnLoad(go);
            PlaytestBridge.Register(go.AddComponent<PlaytestUguiTarget>());
        }

        public virtual bool IsReady => EventSystem.current != null;
        public virtual bool IsDone => false; // personas decide when they are done
        public virtual void ResetGame(int seed) { /* a fresh process is a fresh session */ }

        public virtual void ApplyAction(string actionJson)
        {
            var a = JsonUtility.FromJson<UguiAction>(actionJson);
            if (!string.IsNullOrEmpty(a.tap)) Ugui.TapButton(a.tap);
            else if (a.tapAt != null && a.tapAt.Length == 2) Ugui.TapAt(new Vector2(a.tapAt[0] * Screen.width, (1f - a.tapAt[1]) * Screen.height));
        }

        public virtual string ObserveJson()
        {
            var sb = new StringBuilder("{");
            sb.Append("\"text\":[").Append(string.Join(",", Ugui.VisibleTexts().Select(t => $"\"{Ugui.Esc(t)}\""))).Append(']');
            sb.Append(",\"buttons\":[").Append(string.Join(",", Ugui.VisibleButtons().Select(t => $"\"{Ugui.Esc(t)}\""))).Append(']');
            AppendObservation(sb);
            return sb.Append('}').ToString();
        }

        /// <summary>Override to add game-specific fields: sb.Append(",\"board\":\"...\"").</summary>
        protected virtual void AppendObservation(StringBuilder sb) { }

        public virtual string MetricsJson() => "{}";
    }

    /// <summary>Helpers to perceive and drive a uGUI screen the way a player would (EventSystem events, not direct calls).</summary>
    public static class Ugui
    {
        /// <summary>Readable text currently on screen (excluding button labels).</summary>
        public static IEnumerable<string> VisibleTexts()
        {
            var seen = new HashSet<string>();
            foreach (var t in UnityEngine.Object.FindObjectsByType<Text>(FindObjectsSortMode.None))
            {
                if (!t.isActiveAndEnabled || t.color.a < 0.05f || string.IsNullOrWhiteSpace(t.text)) continue;
                if (t.GetComponentInParent<Button>() != null) continue;
                if (!OnScreen(t.rectTransform) || Hidden(t.transform)) continue;
                string s = t.text.Trim().Replace("\n", " ");
                if (seen.Add(s)) yield return s;
            }
        }

        /// <summary>Labels of interactable buttons on screen (icon buttons are reported by name).</summary>
        public static IEnumerable<string> VisibleButtons()
        {
            foreach (var b in UnityEngine.Object.FindObjectsByType<Button>(FindObjectsSortMode.None))
            {
                if (!b.isActiveAndEnabled || !b.interactable || !OnScreen((RectTransform)b.transform) || Hidden(b.transform)) continue;
                var label = b.GetComponentsInChildren<Text>().Select(x => x.text.Trim()).FirstOrDefault(x => x.Length > 0);
                yield return string.IsNullOrEmpty(label) ? $"(icon button {b.name})" : label.Replace("\n", " ");
            }
        }

        /// <summary>Clicks the first interactable button whose label or name contains <paramref name="label"/>.</summary>
        public static bool TapButton(string label)
        {
            foreach (var b in UnityEngine.Object.FindObjectsByType<Button>(FindObjectsSortMode.None))
            {
                if (!b.isActiveAndEnabled || !b.interactable) continue;
                var text = string.Join(" ", b.GetComponentsInChildren<Text>().Select(x => x.text));
                if (text.IndexOf(label, StringComparison.OrdinalIgnoreCase) < 0 && b.name.IndexOf(label, StringComparison.OrdinalIgnoreCase) < 0) continue;
                ExecuteEvents.Execute(b.gameObject, Pointer(RectTransformUtility.WorldToScreenPoint(null, b.transform.position)), ExecuteEvents.pointerClickHandler);
                return true;
            }
            Debug.LogWarning($"[PlaytestLab] no button matching '{label}'");
            return false;
        }

        /// <summary>Clicks whatever handles a click at a screen point (pixels, bottom-left origin).</summary>
        public static bool TapAt(Vector2 screen)
        {
            if (EventSystem.current == null) return false;
            var e = Pointer(screen);
            var hits = new List<RaycastResult>();
            EventSystem.current.RaycastAll(e, hits);
            foreach (var h in hits)
            {
                var handler = ExecuteEvents.GetEventHandler<IPointerClickHandler>(h.gameObject);
                if (handler == null) continue;
                e.pointerCurrentRaycast = h;
                ExecuteEvents.Execute(handler, e, ExecuteEvents.pointerClickHandler);
                return true;
            }
            return false;
        }

        public static PointerEventData Pointer(Vector2 pos) =>
            new PointerEventData(EventSystem.current) { position = pos, pressPosition = pos, button = PointerEventData.InputButton.Left };

        public static bool OnScreen(RectTransform rt)
        {
            var corners = new Vector3[4];
            rt.GetWorldCorners(corners);
            var r = new Rect(0, 0, Screen.width, Screen.height);
            return corners.Any(c => r.Contains(RectTransformUtility.WorldToScreenPoint(null, c)));
        }

        public static bool Hidden(Transform t)
        {
            foreach (var g in t.GetComponentsInParent<CanvasGroup>()) if (g.alpha < 0.05f) return true;
            return false;
        }

        public static string Esc(string s) => (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "");
    }
}
