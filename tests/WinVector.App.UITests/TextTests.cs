using System.Drawing;
using System.Text.RegularExpressions;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Input;
using FlaUI.Core.Tools;
using FlaUI.Core.WindowsAPI;

namespace WinVector.App.UITests;

/// <summary>
/// Texto de la Fase 4 de punta a punta (issue #99): crear un texto con tildes y varias líneas,
/// cambiar su fuente y su alineación desde el panel, guardar y volver a abrir, y el aviso de una
/// fuente que no está instalada.
/// </summary>
/// <remarks>
/// Los textos de la interfaz dependen del idioma de Windows: las pruebas comparan identificadores,
/// valores y el archivo guardado, nunca textos traducidos.
/// </remarks>
[TestClass]
public sealed partial class TextTests
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
        _file = Path.Combine(_folder, "texto.svg");
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

    /// <summary>Abre el archivo de la prueba y espera al motor.</summary>
    private void Launch()
    {
        _session = AppSession.Start($"\"{_file}\"");
        Assert.IsTrue(
            Retry.WhileFalse(() => !string.IsNullOrEmpty(Session.FindById("EngineStatus")?.Properties.HelpText.ValueOrDefault), EngineStartTimeout).Result,
            "El motor no terminó de cargar.");
    }

    private Rectangle Canvas => Session.GetById("EngineCanvas").BoundingRectangle;

    /// <summary>Punto de la pantalla de un punto del documento de ejemplo (viewBox 400 × 300).</summary>
    private Point At(double x, double y) => AppSession.SamplePoint(Canvas, x, y);

    /// <summary>Elige una herramienta con su atajo, con el lienzo enfocado.</summary>
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

    /// <summary>Busca un control del panel, lo desplaza hasta que se ve y espera a que esté activo.</summary>
    private AutomationElement PanelControl(string automationId)
    {
        var control = Retry.WhileNull(() => Session.FindById(automationId), EngineTimeout).Result
            ?? throw new AssertFailedException($"No aparece {automationId} en el panel.");
        control.Patterns.ScrollItem.PatternOrDefault?.ScrollIntoView();
        Assert.IsTrue(Retry.WhileFalse(() => control.IsEnabled, EngineTimeout).Result, $"{automationId} no está activo.");
        return control;
    }

    [TestMethod]
    public void UnTextoConTildesYDosLineasCambiaDeFuenteSeGuardaYSeVuelveAAbrir()
    {
        Launch();
        // En el cielo, a la izquierda del sol y por encima de la tarjeta (que empieza en y = 58).
        UseShortcut(VirtualKeyShort.KEY_T, "ToolText");
        Mouse.Click(At(20, 24));
        Thread.Sleep(300);
        Keyboard.Type("Canción");
        Keyboard.Type(VirtualKeyShort.RETURN);
        Keyboard.Type("año");
        Keyboard.Type(VirtualKeyShort.ESCAPE);
        WaitForSelection("text");

        // La fuente, escrita en su lista (también vale una que no esté instalada); y centrado.
        var font = PanelControl("TextFontBox");
        font.Focus();
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_A);
        Keyboard.Type("Georgia");
        Keyboard.Type(VirtualKeyShort.RETURN);
        PanelControl("TextAlignCenterButton").Click();

        var svg = Retry.WhileNull(() => SaveContaining("text-anchor=\"middle\""), EngineTimeout, TimeSpan.FromSeconds(1)).Result
            ?? throw new AssertFailedException("La alineación no se guardó.");
        StringAssert.Matches(svg, NewText());
        var text = NewText().Match(svg).Value;
        StringAssert.Contains(text, "font-family=\"Georgia, serif\"");
        StringAssert.Contains(svg, ">Canción</tspan>");
        StringAssert.Contains(svg, ">año</tspan>");

        // Se vuelve a abrir: el texto conserva su fuente, que se ve en el panel.
        _session?.Dispose();
        _session = null;
        Launch();
        UseShortcut(VirtualKeyShort.KEY_V, "ToolSelect");
        Mouse.Click(At(20, 20));
        WaitForSelection("text");
        var reopened = PanelControl("TextFontBox").AsComboBox();
        Assert.IsTrue(
            Retry.WhileFalse(() => FontShown(reopened).Contains("Georgia", StringComparison.Ordinal), EngineTimeout, TimeSpan.FromMilliseconds(500)).Result,
            $"Al volver a abrir, el panel no muestra la fuente del texto (muestra '{FontShown(reopened)}').");
    }

    /// <summary>La fuente que muestra la lista del panel: la elegida o, si no está en la lista, la escrita.</summary>
    private static string FontShown(ComboBox box)
    {
        try
        {
            return box.SelectedItem?.Text is { Length: > 0 } selected ? selected : box.EditableText ?? string.Empty;
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.Runtime.InteropServices.COMException or FlaUI.Core.Exceptions.PatternNotSupportedException)
        {
            return string.Empty;
        }
    }

    /// <summary>Guarda y devuelve el texto si contiene <paramref name="text"/>, o null para volver a intentarlo.</summary>
    private string? SaveContaining(string text)
    {
        var svg = Save();
        return svg.Contains(text, StringComparison.Ordinal) ? svg : null;
    }

    [TestMethod]
    public void UnDocumentoConUnaFuenteQueNoEstaInstaladaAvisaDeEllaYNoCambia()
    {
        const string Missing = """
            <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
              <text x="40" y="60" font-family="'Fuente Que No Existe', serif" font-size="20">Hola</text>
            </svg>
            """;
        File.WriteAllText(_file, Missing);
        Launch();

        var bar = Retry.WhileNull(() => Session.FindById("MissingFontsBar"), EngineTimeout, TimeSpan.FromMilliseconds(500)).Result;
        Assert.IsNotNull(bar, "No se avisó de la fuente que falta.");

        // Guardar sin cambios deja el archivo como estaba: el nombre de la fuente se conserva.
        Mouse.Click(new Point(Canvas.X + 4, Canvas.Y + 4));
        Assert.AreEqual(Missing, Save());
    }

    [GeneratedRegex("<text (?![^>]*id=)[^>]*>")]
    private static partial Regex NewText();
}
