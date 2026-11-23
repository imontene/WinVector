using System.Drawing;
using System.Text.RegularExpressions;
using FlaUI.Core.Input;
using FlaUI.Core.Tools;
using FlaUI.Core.WindowsAPI;

namespace WinVector.App.UITests;

/// <summary>
/// Edición de trazados de la Fase 3 de punta a punta (issue #81): la pluma con curvas, los nodos, las
/// operaciones del menú Trazado con la regla de relleno y el redondeo de vértices, hasta guardar el
/// archivo y volver a abrirlo. El menú contextual (#73) lo prueban MainWindowTests.
/// </summary>
/// <remarks>
/// Los textos de la interfaz dependen del idioma de Windows: las pruebas comparan identificadores,
/// cambios de nombre y el archivo guardado, nunca textos traducidos.
/// </remarks>
[TestClass]
public sealed partial class PathTests
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
        _file = Path.Combine(_folder, "trazados.svg");
        File.Copy(Path.Combine(AppContext.BaseDirectory, "Ejemplo.svg"), _file);
        Launch();
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

    /// <summary>Elige una herramienta con su botón, sin tocar el lienzo (la selección no cambia).</summary>
    private void UseToolButton(string tool)
    {
        Session.GetById(tool).Click();
        Assert.IsTrue(Retry.WhileFalse(() => IsToolChecked(tool), TimeSpan.FromSeconds(5)).Result, $"No se eligió {tool}.");
    }

    private bool IsToolChecked(string automationId) =>
        Session.FindById(automationId)?.Patterns.Toggle.PatternOrDefault?.ToggleState.ValueOrDefault == FlaUI.Core.Definitions.ToggleState.On;

    private string WaitForSelection(string prefix)
    {
        var status = Session.WaitForName("SelectionStatus", name => name.StartsWith(prefix, StringComparison.Ordinal), EngineTimeout);
        Assert.IsTrue(status.StartsWith(prefix, StringComparison.Ordinal), $"Se esperaba {prefix} seleccionado y la selección es '{status}'.");
        return status;
    }

    /// <summary>Espera a que el resumen de nodos del panel cambie respecto a <paramref name="before"/>.</summary>
    private string WaitForNodesText(string before)
    {
        var text = Session.WaitForName("SelectedNodesText", name => name.Length > 0 && name != before, EngineTimeout);
        Assert.AreNotEqual(before, text, "El resumen de los nodos seleccionados no cambió.");
        return text;
    }

    private string NodesText() => Session.FindById("SelectedNodesText")?.Name ?? string.Empty;

    /// <summary>El `d` del trazado nuevo del archivo: el primero sin identificador.</summary>
    private static string NewPathData(string svg) =>
        NewPath().Match(svg) is { Success: true } match ? match.Groups[1].Value : throw new AssertFailedException("No hay un trazado nuevo en el archivo.");

    private void InvokeMenu(string menu, string automationId)
    {
        Session.GetById(menu).Patterns.ExpandCollapse.Pattern.Expand();
        var item = Retry.WhileNull(() => Session.FindInApp(automationId), TimeSpan.FromSeconds(10), TimeSpan.FromMilliseconds(250)).Result
            ?? throw new AssertFailedException($"No aparece {automationId} en el menú.");
        Assert.IsTrue(Retry.WhileFalse(() => item.IsEnabled, EngineTimeout).Result, $"{automationId} está desactivado.");
        item.Patterns.Invoke.Pattern.Invoke();
    }

    /// <summary>Escribe un valor en un campo numérico del panel.</summary>
    private void SetNumber(string automationId, double value)
    {
        var box = Retry.WhileNull(() => Session.FindById(automationId), EngineTimeout).Result
            ?? throw new AssertFailedException($"No aparece el campo {automationId}.");
        // El panel tiene desplazamiento: la sección de nodos puede quedar por debajo de lo que se ve.
        box.Patterns.ScrollItem.PatternOrDefault?.ScrollIntoView();
        Assert.IsTrue(Retry.WhileFalse(() => box.IsEnabled, EngineTimeout).Result, $"El campo {automationId} no está disponible.");
        box.Patterns.RangeValue.Pattern.SetValue(value);
        Assert.IsTrue(
            Retry.WhileFalse(() => Math.Abs(box.Patterns.RangeValue.Pattern.Value - value) < 0.01, EngineTimeout).Result,
            $"El campo {automationId} no muestra {value}.");

        // El teclado sale del campo: con el foco en él, Ctrl+S no llega a la ventana.
        Session.GetById("ToolSelect").Focus();
    }

    /// <summary>Guarda con Ctrl+S y devuelve el texto del archivo.</summary>
    private string Save()
    {
        var before = File.GetLastWriteTimeUtc(_file);
        // Justo después de elegir en una lista desplegable, Ctrl+S puede llegar a su ventana emergente
        // mientras se cierra y perderse: se vuelve a pulsar. Guardar dos veces no cambia el archivo.
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
                // La aplicación aún lo está escribiendo.
                Thread.Sleep(250);
            }
        }
    }

    [TestMethod]
    public void LaPlumaDibujaCurvasYLosNodosSeAnadenQuitanYCambianDeTipo()
    {
        // En el cielo despejado, a la izquierda de la tarjeta (x < 45).
        UseShortcut(VirtualKeyShort.KEY_P, "ToolPen");
        Mouse.Click(At(8, 8));
        // Arrastrar crea un nodo suave con sus manejadores.
        Mouse.Drag(At(40, 8), At(40, 24));
        Mouse.Click(At(24, 40));
        // Clic en el primer nodo: se cierra.
        Mouse.Click(At(8, 8));
        WaitForSelection("path");

        UseToolButton("ToolVertex");
        var drawn = NewPathData(Save());

        // Doble clic en la recta de cierre, de (24,40) a (8,8): un nodo nuevo, seleccionado.
        Mouse.DoubleClick(At(16, 24));
        Assert.IsTrue(Retry.WhileFalse(() => NodesText().Length > 0, EngineTimeout).Result, "El nodo nuevo no quedó seleccionado.");
        var added = NewPathData(Save());
        Assert.AreNotEqual(drawn, added, "Añadir un nodo no cambió el trazado.");

        // Supr lo quita: entre dos rectas vuelve a quedar una recta, como antes.
        Keyboard.Type(VirtualKeyShort.DELETE);
        Assert.IsTrue(Retry.WhileFalse(() => NodesText().Length == 0, EngineTimeout).Result, "Supr no quitó el nodo.");
        WaitForSelection("path");
        Assert.AreEqual(drawn, NewPathData(Save()), "Quitar el nodo nuevo no devolvió el trazado dibujado.");

        // El nodo de abajo es una esquina entre dos rectas; Mayús+S lo hace suave.
        Mouse.Click(At(24, 40));
        var corner = WaitForNodesText(string.Empty);
        Keyboard.TypeSimultaneously(VirtualKeyShort.SHIFT, VirtualKeyShort.KEY_S);
        WaitForNodesText(corner);

        var svg = Save();
        StringAssert.Matches(svg, CurvedClosedPath());
    }

    [TestMethod]
    public void CombinarConParImparYSepararSeGuarda()
    {
        // Dos rectángulos, uno dentro de otro, en el cielo a la izquierda de la tarjeta.
        UseShortcut(VirtualKeyShort.KEY_R, "ToolRectangle");
        Mouse.Drag(At(4, 60), At(44, 140));
        WaitForSelection("rect");
        Mouse.Drag(At(14, 90), At(34, 110));
        WaitForSelection("rect");

        // Con Selección, Mayús+clic en el grande (fuera del pequeño) los selecciona a los dos.
        UseToolButton("ToolSelect");
        AppSession.ShiftClick(At(8, 70));
        WaitForSelection("2");

        InvokeMenu("PathMenu", "MenuPathCombine");
        WaitForSelection("path");

        // Regla de relleno par-impar en el panel Apariencia: el pequeño es un agujero.
        var rule = Retry.WhileNull(() => Session.FindById("FillRuleBox"), EngineTimeout).Result
            ?? throw new AssertFailedException("No aparece la regla de relleno.");
        rule.Patterns.ExpandCollapse.Pattern.Expand();
        var evenodd = Retry.WhileNull(() => Session.FindInApp("FillRuleEvenodd"), TimeSpan.FromSeconds(10), TimeSpan.FromMilliseconds(250)).Result
            ?? throw new AssertFailedException("No aparece la opción par-impar.");
        evenodd.Patterns.SelectionItem.Pattern.Select();
        if (rule.Patterns.ExpandCollapse.Pattern.ExpandCollapseState.Value == FlaUI.Core.Definitions.ExpandCollapseState.Expanded)
        {
            rule.Patterns.ExpandCollapse.Pattern.Collapse();
        }

        var combined = Retry.WhileNull(() => SaveContaining("fill-rule=\"evenodd\""), EngineTimeout, TimeSpan.FromSeconds(1)).Result
            ?? throw new AssertFailedException("La regla de relleno no se guardó.");
        Assert.AreEqual(1, EvenOddPaths().Count(combined), "Combinar debe dejar un solo trazado con los dos rectángulos.");
        Assert.AreEqual(0, Regex.Count(combined, "<rect (?![^>]*id=)"), "Los rectángulos nuevos siguen en el archivo.");

        InvokeMenu("PathMenu", "MenuPathSeparate");
        WaitForSelection("2");
        var separated = Save();
        Assert.AreEqual(2, EvenOddPaths().Count(separated), "Separar debe dejar dos trazados con el mismo estilo.");
    }

    /// <summary>Guarda y devuelve el texto si contiene <paramref name="text"/>, o null para volver a intentarlo.</summary>
    private string? SaveContaining(string text)
    {
        var svg = Save();
        return svg.Contains(text, StringComparison.Ordinal) ? svg : null;
    }

    [TestMethod]
    public void DosEsquinasRedondeadasSeGuardanSeVuelvenAAbrirYSeCambian()
    {
        UseShortcut(VirtualKeyShort.KEY_R, "ToolRectangle");
        Mouse.Drag(At(8, 8), At(40, 40));
        WaitForSelection("rect");

        // Con Vértices, el radio de cada esquina en el panel. El rectángulo pasa a ser un trazado.
        UseToolButton("ToolVertex");
        Mouse.Click(At(40, 8));
        SetNumber("CornerRadiusBox", 5);
        // Un clic en otro vértice lo selecciona solo a él.
        Mouse.Click(At(8, 40));
        SetNumber("CornerRadiusBox", 3);

        var svg = Save();
        StringAssert.Matches(svg, RoundedPath("0:1=5 0:3=3"));

        // Se vuelve a abrir el archivo: el radio sigue ahí y se puede cambiar.
        _session?.Dispose();
        _session = null;
        Launch();
        UseShortcut(VirtualKeyShort.KEY_V, "ToolSelect");
        Mouse.Click(At(24, 24));
        WaitForSelection("path");
        UseToolButton("ToolVertex");
        Mouse.Click(At(40, 8));
        var box = Retry.WhileNull(() => Session.FindById("CornerRadiusBox"), EngineTimeout).Result
            ?? throw new AssertFailedException("No aparece el radio de la esquina.");
        Assert.IsTrue(
            Retry.WhileFalse(() => Math.Abs(box.Patterns.RangeValue.Pattern.Value - 5) < 0.01, EngineTimeout).Result,
            "Al volver a abrir, la esquina no tiene su radio.");
        SetNumber("CornerRadiusBox", 0);

        StringAssert.Matches(Save(), RoundedPath("0:3=3"));
    }

    [TestMethod]
    public void TodasLasEsquinasDeDosFigurasSeRedondeanALaVez()
    {
        // Dos rectángulos convertidos en trazados, en el cielo a la izquierda de la tarjeta.
        UseShortcut(VirtualKeyShort.KEY_R, "ToolRectangle");
        Mouse.Drag(At(4, 8), At(30, 40));
        WaitForSelection("rect");
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.SHIFT, VirtualKeyShort.KEY_C);
        WaitForSelection("path");
        Mouse.Drag(At(36, 8), At(44, 40));
        WaitForSelection("rect");
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.SHIFT, VirtualKeyShort.KEY_C);
        WaitForSelection("path");

        // Con Selección, los dos; el radio del panel redondea todas sus esquinas (issue #114).
        UseToolButton("ToolSelect");
        AppSession.ShiftClick(At(16, 24));
        WaitForSelection("2");
        SetNumber("ObjectCornerRadiusBox", 3);

        var svg = Retry.WhileNull(() => SaveContaining("data-winvector-corner-radii"), EngineTimeout, TimeSpan.FromSeconds(1)).Result
            ?? throw new AssertFailedException("El redondeo no se guardó.");
        Assert.AreEqual(2, RoundedPath("0:0=3 0:1=3 0:2=3 0:3=3").Count(svg), "Las dos figuras deben tener sus cuatro esquinas redondeadas.");

        // Se vuelve a abrir: el panel muestra el radio y 0 lo quita.
        _session?.Dispose();
        _session = null;
        Launch();
        UseShortcut(VirtualKeyShort.KEY_V, "ToolSelect");
        Mouse.Click(At(16, 24));
        WaitForSelection("path");
        var box = Retry.WhileNull(() => Session.FindById("ObjectCornerRadiusBox"), EngineTimeout).Result
            ?? throw new AssertFailedException("No aparece el radio de las esquinas.");
        Assert.IsTrue(
            Retry.WhileFalse(() => Math.Abs(box.Patterns.RangeValue.Pattern.Value - 3) < 0.01, EngineTimeout).Result,
            "Al volver a abrir, el panel no muestra el radio de las esquinas.");
        SetNumber("ObjectCornerRadiusBox", 0);

        Assert.AreEqual(1, Regex.Count(Save(), "data-winvector-corner-radii="), "Solo la otra figura sigue redondeada.");
    }

    [GeneratedRegex("<path [^>]*d=\"M[^\"]*[CcSs][^\"]*Z\"")]
    private static partial Regex CurvedClosedPath();

    [GeneratedRegex("<path (?![^>]*id=)[^>]*d=\"([^\"]*)\"")]
    private static partial Regex NewPath();

    [GeneratedRegex("<path [^>]*fill-rule=\"evenodd\"")]
    private static partial Regex EvenOddPaths();

    private static Regex RoundedPath(string radii) =>
        new($"<path [^>]*data-winvector-corner-radii=\"{Regex.Escape(radii)}\"");
}
