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

    [TestMethod]
    public void UnPredefinidoDeLaBibliotecaSeAplicaYApareceEnLaDelDocumento()
    {
        Launch();
        SelectSun();
        OpenFill();

        // Atardecer: un degradado nuevo con sus paradas (issue #112).
        InFlyout("FillGradientPreset_Sunset").Patterns.Invoke.Pattern.Invoke();
        WaitForStops(2);
        // El documento ya tenía #cielo; ahora también el nuevo.
        Assert.IsNotNull(
            Retry.WhileNull(() => Session.FindInApp("FillGradientLibrary_degradado"), EngineTimeout, TimeSpan.FromMilliseconds(250)).Result,
            "El degradado nuevo no aparece en la biblioteca del documento.");
        Keyboard.Type(VirtualKeyShort.ESCAPE);

        var svg = Retry.WhileNull(() => SaveContaining("#ff7e5f"), EngineTimeout, TimeSpan.FromSeconds(1)).Result
            ?? throw new AssertFailedException("El predefinido no se guardó.");
        StringAssert.Contains(svg, "fill=\"url(#degradado)\"");
    }

    private Point At(double x, double y) => AppSession.SamplePoint(Session.GetById("EngineCanvas").BoundingRectangle, x, y);

    /// <summary>Elige una herramienta con su atajo, con el lienzo enfocado.</summary>
    private void UseShortcut(VirtualKeyShort key, string tool)
    {
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        for (var attempt = 0; attempt < 3; attempt++)
        {
            Mouse.Click(new Point(canvas.X + 4, canvas.Y + 4));
            Thread.Sleep(200);
            Keyboard.Type(key);
            if (Retry.WhileFalse(
                () => Session.FindById(tool)?.Patterns.Toggle.PatternOrDefault?.ToggleState.ValueOrDefault == FlaUI.Core.Definitions.ToggleState.On,
                TimeSpan.FromSeconds(5)).Result)
            {
                return;
            }
        }

        Assert.Fail($"El atajo no eligió la herramienta {tool}.");
    }

    /// <summary>Un atributo numérico del degradado nuevo del archivo.</summary>
    private static double GradientNumber(string svg, string name)
    {
        var gradient = NewLinearGradient().Match(svg);
        Assert.IsTrue(gradient.Success, "No hay un degradado lineal nuevo.");
        var value = Regex.Match(gradient.Value, $"\\b{name}=\"([^\"]+)\"");
        Assert.IsTrue(value.Success, $"El degradado no tiene {name}.");
        return double.Parse(value.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
    }

    [TestMethod]
    public void LaHerramientaDegradadoCreaUnoArrastrandoYMueveSuExtremo()
    {
        Launch();
        // La tarjeta del ejemplo va de (48, 58) a (198, 146).
        UseShortcut(VirtualKeyShort.KEY_D, "ToolGradient");
        Mouse.Drag(At(60, 100), At(180, 100));
        var created = Retry.WhileNull(() => SaveContaining("<linearGradient id=\"degradado\""), EngineTimeout, TimeSpan.FromSeconds(1)).Result
            ?? throw new AssertFailedException("Arrastrar sobre la tarjeta no le puso un degradado.");
        StringAssert.Contains(created, "fill=\"url(#degradado)\"");
        Assert.AreEqual(60, GradientNumber(created, "x1"), 2);
        Assert.AreEqual(180, GradientNumber(created, "x2"), 2);

        // El extremo se arrastra hasta (150, 130).
        Mouse.Drag(At(180, 100), At(150, 130));
        var moved = Retry.WhileNull(
            () => Save() is { } svg && Math.Abs(GradientNumber(svg, "x2") - 150) < 2 ? svg : null,
            EngineTimeout,
            TimeSpan.FromSeconds(1)).Result
            ?? throw new AssertFailedException("Arrastrar el extremo no lo movió.");
        Assert.AreEqual(130, GradientNumber(moved, "y2"), 2);
    }

    [GeneratedRegex("<linearGradient id=\"degradado\"[^>]*>")]
    private static partial Regex NewLinearGradient();

    [GeneratedRegex("<radialGradient id=\"([^\"]+)\"[\\s\\S]*?</radialGradient>")]
    private static partial Regex RadialGradient();
}
