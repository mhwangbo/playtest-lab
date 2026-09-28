using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using UnityEngine;

namespace PlaytestLab
{
    /// <summary>
    /// Playtest Lab bridge (protocol "playtest-bridge/1"). Inactive unless the player is launched with
    /// <c>-playtestPort &lt;port&gt;</c> (or env PLAYTEST_PORT, or the editor menu Tools/Playtest Lab).
    ///
    /// Determinism: while active, time runs on a fixed step (<c>Time.captureDeltaTime</c>) and the main
    /// thread blocks between commands, so the game never advances unless the lab asks for frames.
    /// A "step" applies the action and then runs exactly N frames before replying.
    /// </summary>
    [DefaultExecutionOrder(10000)]
    public sealed class PlaytestBridge : MonoBehaviour
    {
        public const string Protocol = "playtest-bridge/1";
        private const int ResetFrameLimit = 1200;

        private static PlaytestBridge _instance;
        private static IPlaytestTarget _target;

        private readonly BlockingCollection<string> _inbox = new BlockingCollection<string>();
        private TcpListener _listener;
        private TcpClient _client;
        private StreamWriter _writer;
        private Thread _thread;
        private int _framesLeft;
        private bool _waitingShot;
        private bool _waitingReset;
        private int _resetFrames;
        private volatile bool _closed;

        /// <summary>Registers the game's playtest target (call in OnEnable).</summary>
        public static void Register(IPlaytestTarget target) => _target = target;

        /// <summary>Unregisters the target (call in OnDisable).</summary>
        public static void Unregister(IPlaytestTarget target)
        {
            if (ReferenceEquals(_target, target)) _target = null;
        }

        /// <summary>True when this process is being driven by Playtest Lab.</summary>
        public static bool IsActive => _instance != null;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Bootstrap()
        {
            int port = ReadPort();
            if (port <= 0 || _instance != null) return;
            var go = new GameObject("PlaytestBridge");
            DontDestroyOnLoad(go);
            _instance = go.AddComponent<PlaytestBridge>();
            _instance.Listen(port);
        }

        private static int ReadPort()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "-playtestPort" && int.TryParse(args[i + 1], out int p)) return p;
            }
            if (int.TryParse(Environment.GetEnvironmentVariable("PLAYTEST_PORT"), out int envPort)) return envPort;
#if UNITY_EDITOR
            return UnityEditor.EditorPrefs.GetInt("PlaytestLab.BridgePort", 0);
#else
            return 0;
#endif
        }

        private void Listen(int port)
        {
            float dt = 1f / 60f;
            string dtArg = ReadArg("-playtestDt");
            if (dtArg != null && float.TryParse(dtArg, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float parsed) && parsed > 0f) dt = parsed;
            Time.captureDeltaTime = dt;
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = -1;
            Application.runInBackground = true;

            _listener = new TcpListener(IPAddress.Loopback, port);
            _listener.Start();
            _thread = new Thread(ReadLoop) { IsBackground = true, Name = "PlaytestBridge" };
            _thread.Start();
            Debug.Log($"[PlaytestBridge] listening on 127.0.0.1:{port} (dt={dt})");
        }

        private static string ReadArg(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++) if (args[i] == name) return args[i + 1];
            return null;
        }

        private void ReadLoop()
        {
            try
            {
                _client = _listener.AcceptTcpClient();
                _client.NoDelay = true;
                var stream = _client.GetStream();
                _writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
                using var reader = new StreamReader(stream, new UTF8Encoding(false));
                string line;
                while (!_closed && (line = reader.ReadLine()) != null)
                {
                    if (line.Length > 0) _inbox.Add(line);
                }
            }
            catch (Exception e)
            {
                if (!_closed) Debug.LogWarning($"[PlaytestBridge] connection ended: {e.Message}");
            }
            finally
            {
                _inbox.Add("{\"cmd\":\"__disconnected\"}");
            }
        }

        private void LateUpdate()
        {
            if (_waitingShot) return; // the capture coroutine replies at end of frame
            if (_framesLeft > 0)
            {
                _framesLeft--;
                if (_framesLeft > 0) return;
                ReplyState();
            }

            if (_waitingReset)
            {
                var t = ResolveTarget();
                if (t == null || !t.IsReady)
                {
                    if (++_resetFrames < ResetFrameLimit) return;
                    _waitingReset = false;
                    Reply("{\"ok\":false,\"error\":\"reset timed out: no ready IPlaytestTarget\"}");
                }
                else
                {
                    _waitingReset = false;
                    ReplyState();
                }
            }

            // Idle: freeze the game until the next command that needs frames.
            while (!_closed)
            {
                string line = TakeCommand();
                if (line == null) return; // editor safety valve: let one frame pass
                if (Handle(line)) return;
            }
        }

        private string TakeCommand()
        {
#if UNITY_EDITOR
            // Never hard-freeze the editor for long; an uncontrolled frame may slip through here.
            return _inbox.TryTake(out string l, 5000) ? l : null;
#else
            return _inbox.Take();
#endif
        }

        /// <summary>Returns true when the command needs frames to run (reset/step/quit).</summary>
        private bool Handle(string line)
        {
            Dictionary<string, string> msg;
            try { msg = BridgeJson.ParseFlat(line); }
            catch (Exception e) { Reply(Error($"bad request: {e.Message}")); return false; }

            msg.TryGetValue("cmd", out string cmd);
            try
            {
                switch (cmd)
                {
                    case "hello":
                        Reply($"{{\"ok\":true,\"protocol\":\"{Protocol}\",\"game\":\"{BridgeJson.Escape(Application.productName)}\",\"engine\":\"unity {BridgeJson.Escape(Application.unityVersion)}\",\"dt\":{Time.captureDeltaTime.ToString(System.Globalization.CultureInfo.InvariantCulture)}}}");
                        return false;
                    case "reset":
                    {
                        var t = ResolveTarget();
                        if (t == null) { Reply(Error("no IPlaytestTarget in scene")); return false; }
                        int seed = msg.TryGetValue("seed", out string s) && int.TryParse(s, out int v) ? v : 0;
                        t.ResetGame(seed);
                        _waitingReset = true;
                        _resetFrames = 0;
                        return true;
                    }
                    case "step":
                    {
                        var t = ResolveTarget();
                        if (t == null) { Reply(Error("no IPlaytestTarget in scene")); return false; }
                        if (msg.TryGetValue("action", out string action) && !string.IsNullOrEmpty(action)) t.ApplyAction(action);
                        int n = msg.TryGetValue("n", out string ns) && int.TryParse(ns, out int nv) ? Mathf.Max(1, nv) : 1;
                        _framesLeft = n;
                        return true;
                    }
                    case "metrics":
                    {
                        var t = ResolveTarget();
                        Reply(t == null ? Error("no IPlaytestTarget in scene") : $"{{\"ok\":true,\"metrics\":{OrEmpty(t.MetricsJson())}}}");
                        return false;
                    }
                    case "screenshot":
                    {
                        // Needs a graphics device (not -nographics). Replies once the PNG is on disk.
                        if (!msg.TryGetValue("path", out string shotPath) || string.IsNullOrEmpty(shotPath)) { Reply(Error("screenshot needs path")); return false; }
                        float scale = msg.TryGetValue("scale", out string sc) && float.TryParse(sc, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float sv) ? Mathf.Clamp(sv, 0.1f, 1f) : 1f;
                        _waitingShot = true;
                        StartCoroutine(Capture(shotPath, scale));
                        return true;
                    }
                    case "quit":
                        Reply("{\"ok\":true}");
                        Shutdown();
                        Application.Quit();
                        return true;
                    case "__disconnected":
                        Shutdown();
                        if (!Application.isEditor) Application.Quit();
                        return true;
                    default:
                        Reply(Error($"unknown cmd '{cmd}'"));
                        return false;
                }
            }
            catch (Exception e)
            {
                Reply(Error($"{cmd} threw {e.GetType().Name}: {e.Message}"));
                return false;
            }
        }

        private void ReplyState()
        {
            var t = ResolveTarget();
            if (t == null) { Reply(Error("target disappeared")); return; }
            string done = t.IsDone ? "true" : "false";
            string violations = "";
            if (t is IPlaytestInvariants inv)
            {
                string v = inv.InvariantsJson();
                if (!string.IsNullOrWhiteSpace(v) && v.Trim() != "[]") violations = $",\"violations\":{v}";
            }
            Reply($"{{\"ok\":true,\"done\":{done},\"obs\":{OrEmpty(t.ObserveJson())}{violations}}}");
        }

        private System.Collections.IEnumerator Capture(string path, float scale)
        {
            // CaptureScreenshotAsTexture can return a blank backbuffer on some graphics APIs (seen on D3D12);
            // CaptureScreenshot(path) is reliable but writes the file a frame or two later, so wait for it.
            string full = Path.GetFullPath(path);
            Directory.CreateDirectory(Path.GetDirectoryName(full));
            if (File.Exists(full)) File.Delete(full);
            yield return new WaitForEndOfFrame();
            ScreenCapture.CaptureScreenshot(full);
            for (int i = 0; i < 120 && !(File.Exists(full) && new FileInfo(full).Length > 0); i++) yield return null;
            yield return null;
            try
            {
                if (!File.Exists(full)) throw new IOException("screenshot file never appeared (is the game window hidden or minimized? personas need a visible window)");
                var shot = new Texture2D(2, 2, TextureFormat.RGB24, false);
                shot.LoadImage(File.ReadAllBytes(full));
                var tex = shot;
                if (scale < 0.999f)
                {
                    int w = Mathf.Max(1, Mathf.RoundToInt(shot.width * scale)), h = Mathf.Max(1, Mathf.RoundToInt(shot.height * scale));
                    var rt = RenderTexture.GetTemporary(w, h);
                    Graphics.Blit(shot, rt);
                    var prev = RenderTexture.active;
                    RenderTexture.active = rt;
                    tex = new Texture2D(w, h, TextureFormat.RGB24, false);
                    tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
                    tex.Apply();
                    RenderTexture.active = prev;
                    RenderTexture.ReleaseTemporary(rt);
                    Destroy(shot);
                }
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
                File.WriteAllBytes(path, tex.EncodeToPNG());
                Destroy(tex);
                Reply($"{{\"ok\":true,\"path\":\"{BridgeJson.Escape(Path.GetFullPath(path))}\"}}");
            }
            catch (Exception e)
            {
                Reply(Error($"screenshot failed: {e.Message}"));
            }
            _waitingShot = false;
        }

        private static IPlaytestTarget ResolveTarget()
        {
            if (_target is UnityEngine.Object o && o == null) _target = null; // destroyed (e.g. scene reload)
            if (_target != null) return _target;
            foreach (var mb in FindObjectsByType<MonoBehaviour>(FindObjectsSortMode.None))
            {
                if (mb is IPlaytestTarget t) { _target = t; break; }
            }
            return _target;
        }

        private static string OrEmpty(string json) => string.IsNullOrWhiteSpace(json) ? "{}" : json;
        private static string Error(string message) => $"{{\"ok\":false,\"error\":\"{BridgeJson.Escape(message)}\"}}";

        private void Reply(string json)
        {
            try { _writer?.WriteLine(json); }
            catch (Exception e) { Debug.LogWarning($"[PlaytestBridge] write failed: {e.Message}"); }
        }

        private void Shutdown()
        {
            if (_closed) return;
            _closed = true;
            try { _client?.Close(); } catch { }
            try { _listener?.Stop(); } catch { }
            Time.captureDeltaTime = 0f;
        }

        private void OnDestroy()
        {
            Shutdown();
            if (_instance == this) _instance = null;
        }
    }
}
