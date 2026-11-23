using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>
/// Degradado predefinido de la biblioteca (issue #112). La interfaz traduce su nombre por la clave
/// ("GradientPresetSunset").
/// </summary>
/// <param name="Key">Clave del nombre, en PascalCase.</param>
/// <param name="Stops">Sus paradas.</param>
public sealed record GradientPreset(string Key, IReadOnlyList<GradientStop> Stops)
{
    /// <summary>Los predefinidos, en el orden en que se muestran.</summary>
    public static IReadOnlyList<GradientPreset> All { get; } =
    [
        new("Fade", [new(0, "#ffffff", 1), new(1, "#ffffff", 0)]),
        new("BlackWhite", [new(0, "#000000", 1), new(1, "#ffffff", 1)]),
        new("Sunset", [new(0, "#ff7e5f", 1), new(1, "#feb47b", 1)]),
        new("Ocean", [new(0, "#2193b0", 1), new(1, "#6dd5ed", 1)]),
        new("Forest", [new(0, "#134e5e", 1), new(1, "#71b280", 1)]),
        new("Metal", [new(0, "#8e9eab", 1), new(0.5, "#eef2f3", 1), new(1, "#8e9eab", 1)]),
        new("Rainbow", [new(0, "#ff0000", 1), new(0.2, "#ff9900", 1), new(0.4, "#ffee00", 1), new(0.6, "#33cc33", 1), new(0.8, "#3399ff", 1), new(1, "#9933cc", 1)]),
    ];
}
