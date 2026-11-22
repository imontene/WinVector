using System.Drawing;
using System.Text;
using FlaUI.Core.Input;
using FlaUI.Core.Tools;
using FlaUI.Core.WindowsAPI;

namespace WinVector.App.UITests;

/// <summary>Diagnóstico temporal del issue #91 (no se fusiona).</summary>
[TestClass]
public sealed class ShiftDiagTests
{
    private AppSession? _session;
    private string _folder = string.Empty;
    private readonly StringBuilder _log = new();

    public TestContext TestContext { get; set; } = null!;

    private AppSession Session => _session ?? throw new InvalidOperationException("La aplicación no está en marcha.");

    [TestInitialize]
    public void Start()
    {
        _folder = Path.Combine(AppContext.BaseDirectory, "archivos-de-prueba", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_folder);
        var file = Path.Combine(_folder, "diag.svg");
        File.Copy(Path.Combine(AppContext.BaseDirectory, "Ejemplo.svg"), file);
        _session = AppSession.Start($"\"{file}\"");
        Assert.IsTrue(
            Retry.WhileFalse(() => !string.IsNullOrEmpty(Session.FindById("EngineStatus")?.Properties.HelpText.ValueOrDefault), TimeSpan.FromSeconds(60)).Result,
            "El motor no terminó de cargar.");
    }

    [TestCleanup]
    public void Stop()
    {
        _session?.Dispose();
        _session = null;
        Directory.Delete(_folder, recursive: true);
    }

    private Rectangle Canvas => Session.GetById("EngineCanvas").BoundingRectangle;

    private Point At(double x, double y) => AppSession.SamplePoint(Canvas, x, y);

    private string Status() => Session.FindById("SelectionStatus")?.Name ?? "?";

    private string Diag() => Session.FindById("diag91")?.Name ?? "(sin diag91)";

    private void Note(string text)
    {
        _log.AppendLine(text);
        TestContext.WriteLine(text);
    }

    /// <summary>Selecciona solo el grupo del fondo (el sol) con un clic normal.</summary>
    private void SelectSun()
    {
        Mouse.Click(At(300, 96));
        var status = Session.WaitForName("SelectionStatus", n => n.StartsWith('g'), TimeSpan.FromSeconds(5));
        Note($"  base: '{status}'");
    }

    private void Variant(string name, Action prepare, Action shiftClick)
    {
        Note($"== {name}");
        prepare();
        SelectSun();
        var before = Diag();
        shiftClick();
        var status = Session.WaitForName("SelectionStatus", n => n.StartsWith('2'), TimeSpan.FromSeconds(4));
        Note($"  resultado: '{status}' -> {(status.StartsWith('2') ? "AÑADE" : "SUSTITUYE")}");
        var after = Diag();
        Note($"  diag antes: {Tail(before)}");
        Note($"  diag después: {Tail(after)}");
    }

    private static string Tail(string text) => text.Length > 1400 ? text[^1400..] : text;

    private Point Card => At(185, 136);

    [TestMethod]
    public void MayusClicDiagnostico()
    {
        Note($"diag inicial: {Diag()}");

        // V: atajo con el lienzo enfocado, como PathTests.
        Mouse.Click(new Point(Canvas.X + 4, Canvas.Y + 4));
        Thread.Sleep(200);
        Keyboard.Type(VirtualKeyShort.KEY_V);
        Thread.Sleep(300);

        Variant("1 Pressing + 500 ms + Click", () => { }, () =>
        {
            using (Keyboard.Pressing(VirtualKeyShort.SHIFT))
            {
                Thread.Sleep(500);
                Mouse.Click(Card);
                Thread.Sleep(200);
            }
        });

        Variant("2 Pressing sin pausa + Click", () => { }, () =>
        {
            using (Keyboard.Pressing(VirtualKeyShort.SHIFT))
            {
                Mouse.Click(Card);
            }
        });

        Variant("3 Press/Down/Up/Release con pausas", () => { }, () =>
        {
            Keyboard.Press(VirtualKeyShort.SHIFT);
            Thread.Sleep(300);
            Mouse.MoveTo(Card);
            Thread.Sleep(100);
            Mouse.Down(MouseButton.Left);
            Thread.Sleep(100);
            Mouse.Up(MouseButton.Left);
            Thread.Sleep(300);
            Keyboard.Release(VirtualKeyShort.SHIFT);
        });

        Variant("4 LSHIFT", () => { }, () =>
        {
            using (Keyboard.Pressing(VirtualKeyShort.LSHIFT))
            {
                Thread.Sleep(500);
                Mouse.Click(Card);
                Thread.Sleep(200);
            }
        });

        Variant("5 foco en el botón de la herramienta", () => Session.GetById("ToolSelect").Click(), () =>
        {
            using (Keyboard.Pressing(VirtualKeyShort.SHIFT))
            {
                Thread.Sleep(500);
                Mouse.Click(Card);
                Thread.Sleep(200);
            }
        });

        Variant("6 mover antes de pulsar Mayús", () => { }, () =>
        {
            Mouse.MoveTo(Card);
            Thread.Sleep(300);
            using (Keyboard.Pressing(VirtualKeyShort.SHIFT))
            {
                Thread.Sleep(500);
                Mouse.Click(Card);
                Thread.Sleep(200);
            }
        });

        Note($"estado final: {Status()}");
        Assert.Fail("Diagnóstico #91 (siempre falla para mostrar el registro):" + Environment.NewLine + _log);
    }
}
