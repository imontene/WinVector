using System.Globalization;
using System.Text.Json;
using FlaUI.Core.Tools;

namespace WinVector.App.UITests;

/// <summary>
/// Mide el arranque de la aplicación (issue #34; objetivo: ventana lista en menos de 2 s en frío).
/// En la CI se ejecuta aparte, justo después de instalar el paquete, para que el primer arranque sea
/// en frío; si <see cref="OutputVariable"/> indica un archivo, escribe ahí los resultados en JSON.
/// </summary>
[TestClass]
[TestCategory(Category)]
public sealed class StartupTests
{
    public const string Category = "Rendimiento";
    public const string OutputVariable = "WINVECTOR_PERF_OUTPUT";

    private static readonly TimeSpan EngineStartTimeout = TimeSpan.FromSeconds(60);

    public TestContext TestContext { get; set; } = null!;

    [TestMethod]
    public void MideElArranqueEnFrioYEnCaliente()
    {
        var cold = Measure();
        var warm = Measure();

        TestContext.WriteLine($"En frío: {cold}");
        TestContext.WriteLine($"En caliente: {warm}");

        var output = Environment.GetEnvironmentVariable(OutputVariable);
        if (!string.IsNullOrEmpty(output))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
            var json = JsonSerializer.Serialize(
                new { measuredAt = DateTimeOffset.UtcNow, cold, warm },
                new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            File.WriteAllText(output, json + "\n");
        }
    }

    /// <summary>Arranca la aplicación, mide cuándo está lista y la cierra.</summary>
    private static Startup Measure()
    {
        using var session = AppSession.Start();
        var window = session.WindowShownAfter ?? session.SinceLaunch;
        var ui = session.SinceLaunch;

        // El motor está listo cuando responde al ping: la barra de estado muestra la latencia.
        var ready = Retry.WhileFalse(
            () => !string.IsNullOrEmpty(session.FindById("EngineStatus")?.Properties.HelpText.ValueOrDefault),
            EngineStartTimeout,
            TimeSpan.FromMilliseconds(20)).Result;
        Assert.IsTrue(ready, "El motor no llegó a estar listo.");
        var engine = session.SinceLaunch;

        return new Startup(Milliseconds(window), Milliseconds(ui), Milliseconds(engine));
    }

    private static int Milliseconds(TimeSpan time) => (int)Math.Round(time.TotalMilliseconds);

    /// <summary>Tiempos desde que se pide arrancar la aplicación, en milisegundos.</summary>
    /// <param name="WindowMs">Hasta que se ve la ventana principal.</param>
    /// <param name="UiMs">Hasta que su interfaz responde a UI Automation.</param>
    /// <param name="EngineMs">Hasta que el motor del lienzo responde.</param>
    private sealed record Startup(int WindowMs, int UiMs, int EngineMs)
    {
        public override string ToString() => string.Create(
            CultureInfo.InvariantCulture,
            $"ventana {WindowMs} ms, interfaz {UiMs} ms, motor {EngineMs} ms");
    }
}
