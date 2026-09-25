using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// <summary>Batch-mode build for the CoinLine sample: creates the scene and a Windows player.</summary>
public static class SampleBuild
{
    private const string ScenePath = "Assets/Scenes/Main.unity";
    private const string OutputPath = "Builds/Win/CoinLine.exe";

    /// <summary>Entry point for -executeMethod SampleBuild.Build.</summary>
    public static void Build()
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
        new GameObject("CoinLineGame").AddComponent<CoinLineGame>();
        System.IO.Directory.CreateDirectory("Assets/Scenes");
        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = new[] { ScenePath },
            locationPathName = OutputPath,
            target = BuildTarget.StandaloneWindows64,
            options = BuildOptions.None,
        });
        Debug.Log($"[SampleBuild] result: {report.summary.result}, errors: {report.summary.totalErrors}");
        EditorApplication.Exit(report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded ? 0 : 1);
    }
}
