using System.Drawing;
using System.Text.RegularExpressions;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Input;
using FlaUI.Core.Tools;
using FlaUI.Core.WindowsAPI;

namespace WinVector.App.UITests;

/// <summary>
/// Degradados desde el panel (issue #109): aplicar uno lineal al sol del ejemplo, añadir y quitar
/// paradas, pasarlo a radial, guardar y volver a abrir.
/// </summary>
/// <remarks>Se comparan identificadores y el archivo guardado, nunca textos traducidos.</remarks>
[TestClass]
public sealed partial class GradientTests
{
    private static readonly TimeSpan EngineTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan EngineStartTimeout = TimeSpan.FromSeconds(60);

    private AppSession? _session;
    private string _folder = string.Empty;
    private string _file = string.Empty;

    public TestContext TestContext { get; set; } = null!;

    private AppSession Session => _session ?? throw new InvalidOperationException("La aplicación no está en marcha.");

    [TestInitialize]
    public void Start()
    {
        // Fuera de AppData: Windows virtualiza las escrituras de las aplicaciones empaquetadas allí.
        _folder = Path.Combine(AppContext.BaseDirectory, "archivos-de-prueba", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_folder);
        _file = Path.Combine(_folder, "degradados.svg");
        File.Copy(Path.Combine(AppContext.BaseDirectory, "Ejemplo.svg"), _file);
    }

    [TestCleanup]
    public void Stop()
    {
        if (_session is not null)
        {
            if (TestContext.CurrentTestOutcome != UnitTestOutcome.Passed)
            {
                AppSession.CaptureScreen(TestContext, TestContext.TestName ?? "fallo");
            }

            _session.Dispose();
            _session = null;
        }

        Directory.Delete(_folder, recursive: true);
    }

    private void Launch()
    {
        _session = AppSession.Start($"\"{_file}\"");
        Assert.IsTrue(
            Retry.WhileFalse(() => !string.IsNullOrEmpty(Session.FindById("EngineStatus")?.Properties.HelpText.ValueOrDefault), EngineStartTimeout).Result,
            "El motor no terminó de cargar.");
    }

    private Point Sun => AppSession.SamplePoint(Session.GetById("EngineCanvas").BoundingRectangle, 300, 96);

    /// <summary>Selecciona el sol (dentro de su grupo) con doble clic.</summary>
    private void SelectSun()
    {
        Mouse.DoubleClick(Sun);
        var status = Session.WaitForName("SelectionStatus", name => name.StartsWith("circle#sol", StringComparison.Ordinal), EngineTimeout);
        Assert.IsTrue(status.StartsWith("circle#sol", StringComparison.Ordinal), $"No se seleccionó el sol: '{status}'.");
    }

    /// <summary>Abre la ventana desplegable del relleno, por accesibilidad (el panel se desplaza).</summary>
    private void OpenFill()
    {
        var fill = Retry.WhileNull(() => Session.FindById("FillButton"), EngineTimeout).Result
            ?? throw new AssertFailedException("No aparece el botón de relleno.");
        fill.Patterns.ScrollItem.PatternOrDefault?.ScrollIntoView();
        if (fill.Patterns.ExpandCollapse.PatternOrDefault is { } expand)
        {
            expand.Expand();
        }
        else
        {
            fill.Click();
        }
    }

    /// <summary>Un control de la ventana desplegable, cuando aparece y está activo.</summary>
    private AutomationElement InFlyout(string automationId)
    {
        var element = Retry.WhileNull(() => Session.FindInApp(automationId), EngineTimeout, TimeSpan.FromMilliseconds(250)).Result
            ?? throw new AssertFailedException($"No aparece {automationId}.");
        Assert.IsTrue(Retry.WhileFalse(() => element.IsEnabled, EngineTimeout).Result, $"{automationId} está desactivado.");
        return element;
    }

    /// <summary>Número de paradas del editor: su lista lo dice en su texto de ayuda ("3 paradas").</summary>
    private int StopCount()
    {
        var help = Session.FindInApp("FillGradientStopBox")?.Properties.HelpText.ValueOrDefault ?? string.Empty;
        var digits = new string(help.TakeWhile(char.IsDigit).ToArray());
        return int.TryParse(digits, System.Globalization.CultureInfo.InvariantCulture, out var count) ? count : -1;
    }

    private void WaitForStops(int count) =>
        Assert.IsTrue(Retry.WhileFalse(() => StopCount() == count, EngineTimeout, TimeSpan.FromMilliseconds(250)).Result, $"El editor no muestra {count} paradas (muestra {StopCount()}).");

    /// <summary>Guarda con Ctrl+S (repitiéndolo si la ventana desplegable se lo come) y devuelve el archivo.</summary>
    private string Save()
    {
        var before = File.GetLastWriteTimeUtc(_file);
        var written = false;
        for (var attempt = 0; attempt < 3 && !written; attempt++)
        {
            Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_S);
            written = Retry.WhileFalse(() => File.GetLastWriteTimeUtc(_file) > before, TimeSpan.FromSeconds(5)).Result;
        }

        Assert.IsTrue(written, "Ctrl+S no escribió el archivo.");
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return File.ReadAllText(_file);
            }
            catch (IOException) when (attempt < 20)
            {
                Thread.Sleep(250);
            }
        }
    }

    private string? SaveContaining(string text)
    {
        var svg = Save();
        return svg.Contains(text, StringComparison.Ordinal) ? svg : null;
    }

    [TestMethod]
    public void UnDegradadoDelPanelConParadasNuevasSeGuardaYSeVuelveAAbrir()
    {
        Launch();
        SelectSun();
        OpenFill();

        // Lineal: del naranja del sol a naranja transparente, con dos paradas.
        InFlyout("FillGradientModeLinear").Patterns.SelectionItem.Pattern.Select();
        WaitForStops(2);

        // Añadir una parada y quitarla; volver a añadirla.
        InFlyout("FillGradientAddStop").Patterns.Invoke.Pattern.Invoke();
        WaitForStops(3);
        InFlyout("FillGradientRemoveStop").Patterns.Invoke.Pattern.Invoke();
        WaitForStops(2);
        InFlyout("FillGradientAddStop").Patterns.Invoke.Pattern.Invoke();
        WaitForStops(3);

        // Pasa a radial con sus mismas paradas.
        InFlyout("FillGradientModeRadial").Patterns.SelectionItem.Pattern.Select();
        Keyboard.Type(VirtualKeyShort.ESCAPE);

        var svg = Retry.WhileNull(() => SaveContaining("<radialGradient"), EngineTimeout, TimeSpan.FromSeconds(1)).Result
            ?? throw new AssertFailedException("El degradado radial no se guardó.");
        var gradient = RadialGradient().Match(svg);
        Assert.IsTrue(gradient.Success, "No hay un degradado radial con su id.");
        Assert.AreEqual(3, Regex.Count(gradient.Value, "<stop "), "El degradado debe tener tres paradas.");
        StringAssert.Contains(svg, $"fill=\"url(#{gradient.Groups[1].Value})\"");

        // Se vuelve a abrir: el panel muestra el degradado radial con sus tres paradas.
        _session?.Dispose();
        _session = null;
        Launch();
        SelectSun();
        Assert.IsTrue(
            Retry.WhileFalse(() => Session.FindById("FillButton")?.Name is { Length: > 0 } name && !name.StartsWith('#'), EngineTimeout).Result,
            "El botón de relleno no muestra un degradado.");
        OpenFill();
        var radial = InFlyout("FillGradientModeRadial");
        Assert.IsTrue(Retry.WhileFalse(() => radial.Patterns.SelectionItem.Pattern.IsSelected.Value, EngineTimeout).Result, "El modo radial no está elegido.");
        WaitForStops(3);
    }

    [GeneratedRegex("<radialGradient id=\"([^\"]+)\"[\\s\\S]*?</radialGradient>")]
    private static partial Regex RadialGradient();
}
