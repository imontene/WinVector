using System.Drawing;
using System.Text.RegularExpressions;
using FlaUI.Core.Input;
using FlaUI.Core.Tools;
using FlaUI.Core.WindowsAPI;

namespace WinVector.App.UITests;

/// <summary>
/// Formas de la Fase 2 de punta a punta (issue #63): crearlas con sus atajos, cambiar sus propiedades
/// en el panel, editar sus vértices, convertirlas en trazados y guardarlas.
/// </summary>
[TestClass]
public sealed partial class ShapeTests
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
        _file = Path.Combine(_folder, "formas.svg");
        File.Copy(Path.Combine(AppContext.BaseDirectory, "Ejemplo.svg"), _file);
        _session = AppSession.Start($"\"{_file}\"");
        Assert.IsTrue(
            Retry.WhileFalse(() => !string.IsNullOrEmpty(Session.FindById("EngineStatus")?.Properties.HelpText.ValueOrDefault), EngineStartTimeout).Result,
            "El motor no terminó de cargar.");
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

    private Rectangle Canvas => Session.GetById("EngineCanvas").BoundingRectangle;

    private Point At(double x, double y) => AppSession.SamplePoint(Canvas, x, y);

    /// <summary>
    /// Elige una herramienta con su atajo, con el lienzo enfocado. Un clic en una esquina vacía del
    /// lienzo le da el teclado (con la herramienta de antes, un clic sin arrastrar no crea nada).
    /// </summary>
    private void UseShortcut(VirtualKeyShort key, string tool)
    {
        var canvas = Canvas;
        for (var attempt = 0; attempt < 3; attempt++)
        {
            Mouse.Click(new Point(canvas.X + 4, canvas.Y + 4));
            Thread.Sleep(200);
            Keyboard.Type(key);
            if (Retry.WhileFalse(() => IsToolChecked(tool), TimeSpan.FromSeconds(5)).Result)
            {
                return;
            }
        }

        Assert.Fail($"El atajo no eligió la herramienta {tool}.");
    }

    private bool IsToolChecked(string automationId) =>
        Session.FindById(automationId)?.Patterns.Toggle.PatternOrDefault?.ToggleState.ValueOrDefault == FlaUI.Core.Definitions.ToggleState.On;

    private string WaitForSelection(string prefix)
    {
        var status = Session.WaitForName("SelectionStatus", name => name.StartsWith(prefix, StringComparison.Ordinal), EngineTimeout);
        Assert.IsTrue(status.StartsWith(prefix, StringComparison.Ordinal), $"Se esperaba {prefix} seleccionado y la selección es '{status}'.");
        return status;
    }

    /// <summary>Guarda con Ctrl+S y devuelve el texto del archivo.</summary>
    private string Save()
    {
        var before = File.GetLastWriteTimeUtc(_file);
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_S);
        Assert.IsTrue(Retry.WhileFalse(() => File.GetLastWriteTimeUtc(_file) > before, TimeSpan.FromSeconds(10)).Result, "Ctrl+S no escribió el archivo.");
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return File.ReadAllText(_file);
            }
            catch (IOException) when (attempt < 20)
            {
                // La aplicación aún lo está escribiendo.
                Thread.Sleep(250);
            }
        }
    }

    [TestMethod]
    public void CadaFormaConSuAtajoSeGuardaComoSuElemento()
    {
        // En el cielo despejado, a la izquierda de la tarjeta (x < 45) y a la derecha del sol (x > 355).
        UseShortcut(VirtualKeyShort.KEY_R, "ToolRectangle");
        Mouse.Drag(At(8, 8), At(40, 30));
        WaitForSelection("rect");

        UseShortcut(VirtualKeyShort.KEY_E, "ToolEllipse");
        Mouse.Drag(At(8, 36), At(40, 54));
        WaitForSelection("ellipse");

        UseShortcut(VirtualKeyShort.KEY_L, "ToolLine");
        Mouse.Drag(At(8, 62), At(40, 80));
        WaitForSelection("line");

        UseShortcut(VirtualKeyShort.KEY_G, "ToolPolygon");
        Mouse.Drag(At(24, 108), At(24, 92));
        WaitForSelection("polygon");

        UseShortcut(VirtualKeyShort.KEY_S, "ToolStar");
        Mouse.Drag(At(24, 148), At(24, 130));
        WaitForSelection("polygon");

        // Las puntas de la estrella, en el panel.
        var sides = Retry.WhileNull(() => Session.FindById("ShapeSides"), EngineTimeout).Result
            ?? throw new AssertFailedException("No aparece el campo de las puntas de la estrella.");
        Assert.IsTrue(Retry.WhileFalse(() => Math.Abs(sides.Patterns.RangeValue.Pattern.Value - 5) < 0.01, EngineTimeout).Result, "El panel no muestra las 5 puntas.");
        sides.Patterns.RangeValue.Pattern.SetValue(7);
        Assert.IsTrue(Retry.WhileFalse(() => Math.Abs(sides.Patterns.RangeValue.Pattern.Value - 7) < 0.01, EngineTimeout).Result, "La estrella no cambió de puntas.");

        UseShortcut(VirtualKeyShort.KEY_P, "ToolPen");
        Mouse.Click(At(362, 8));
        Mouse.Click(At(395, 8));
        Mouse.Click(At(378, 38));
        Mouse.DoubleClick(At(362, 38));
        WaitForSelection("polyline");

        var svg = Save();
        Assert.AreEqual(1, Count(svg, "<rect (?![^>]*id=)"), "Falta el rectángulo nuevo.");
        StringAssert.Contains(svg, "<ellipse ");
        StringAssert.Contains(svg, "<line ");
        StringAssert.Contains(svg, "<polyline ");
        StringAssert.Matches(svg, RegularPolygon());
        StringAssert.Matches(svg, StarWithSevenPoints());
    }

    [TestMethod]
    public void EditarUnVerticeYConvertirEnTrazadoSeGuarda()
    {
        UseShortcut(VirtualKeyShort.KEY_G, "ToolPolygon");
        Mouse.Drag(At(24, 108), At(24, 88));
        WaitForSelection("polygon");

        // Con Vértices, arrastrar el vértice de arriba lo convierte en un polígono normal.
        UseShortcut(VirtualKeyShort.KEY_A, "ToolVertex");
        var toolText = StatusText();
        Mouse.Drag(At(24, 88), At(30, 70));
        // La barra de estado avisa de que el polígono regular pasa a ser un polígono normal.
        Assert.IsTrue(Retry.WhileFalse(() => StatusText() != toolText, EngineTimeout).Result, "No se avisó de la conversión.");

        // Ctrl+Mayús+C con el lienzo enfocado: pasa a trazado.
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.SHIFT, VirtualKeyShort.KEY_C);
        WaitForSelection("path");

        var svg = Save();
        StringAssert.Contains(svg, "<path ");
        Assert.IsFalse(svg.Contains("data-winvector", StringComparison.Ordinal), "El trazado no debe guardar los parámetros del polígono.");
    }

    private string StatusText() => Session.FindById("ToolStatusText")?.Name ?? string.Empty;

    private static int Count(string text, string pattern) => Regex.Count(text, pattern);

    [GeneratedRegex("<polygon [^>]*data-winvector-shape=\"polygon\"")]
    private static partial Regex RegularPolygon();

    [GeneratedRegex("<polygon [^>]*data-winvector-shape=\"star\"[^>]*data-winvector-sides=\"7\"")]
    private static partial Regex StarWithSevenPoints();
}
