using WinVector.Core.Bridge;
using WinVector.Core.Shell;
using WinVector.Core.Tests.Bridge;

namespace WinVector.Core.Tests.Shell;

/// <summary>Propiedades tipográficas de los textos en el panel y el menú Texto (issue #95).</summary>
[TestClass]
public sealed class MainViewModelTextTests : IDisposable
{
    private readonly FakeBridgeTransport _transport = new();
    private readonly BridgeClient _bridge;
    private readonly IDisposable _attachment;
    private readonly MainViewModel _viewModel = new(TestTexts.Instance, new FakeDialogs());
    private readonly FakeEngine _engine;

    public MainViewModelTextTests()
    {
        _bridge = new BridgeClient(_transport);
        _attachment = _viewModel.AttachBridge(_bridge);
        _engine = new FakeEngine(_transport);
    }

    public void Dispose()
    {
        _attachment.Dispose();
        _bridge.Dispose();
    }

    private async Task ReadyAsync()
    {
        _engine.Ready();
        await _viewModel.EngineWork;
    }

    private void SelectText(string text) =>
        _transport.SendEvent(
            "selection.changed",
            $$"""{"documentId":"d1","items":[{"id":null,"tagName":"text"}],"bounds":{"x":0,"y":0,"width":10,"height":10},"scope":null,"text":{{text}}}""");

    private const string Georgia = """{"fontFamily":"Georgia","fontSize":24,"fontWeight":400,"italic":false,"anchor":"start","lineHeight":1.2}""";

    [TestMethod]
    public async Task ElPanelMuestraLasPropiedadesDeLosTextos()
    {
        await ReadyAsync();
        Assert.IsFalse(_viewModel.HasTextProperties);
        Assert.IsFalse(_viewModel.ToggleBoldCommand.CanExecute(null));

        SelectText(Georgia);
        Assert.IsTrue(_viewModel.HasTextProperties);
        Assert.AreEqual("Georgia", _viewModel.TextFontFamily);
        Assert.AreEqual(24, _viewModel.TextFontSize);
        Assert.AreEqual(3, _viewModel.TextFontWeightIndex);
        Assert.IsFalse(_viewModel.IsTextBold);
        Assert.IsTrue(_viewModel.IsTextAlignedStart);
        Assert.AreEqual(1.2, _viewModel.TextLineHeight);
        Assert.IsTrue(_viewModel.ToggleBoldCommand.CanExecute(null));

        // Valores distintos: vacíos.
        SelectText("""{"fontFamily":null,"fontSize":null,"fontWeight":null,"italic":null,"anchor":null,"lineHeight":null}""");
        Assert.IsNull(_viewModel.TextFontFamily);
        Assert.IsTrue(double.IsNaN(_viewModel.TextFontSize));
        Assert.AreEqual(-1, _viewModel.TextFontWeightIndex);
        Assert.IsFalse(_viewModel.IsTextAlignedStart || _viewModel.IsTextAlignedCenter || _viewModel.IsTextAlignedEnd);

        // Sin textos en la selección, la sección desaparece.
        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[{"id":null,"tagName":"rect"}],"bounds":{"x":0,"y":0,"width":10,"height":10},"scope":null}""");
        Assert.IsFalse(_viewModel.HasTextProperties);
    }

    [TestMethod]
    public async Task CadaCambioEnviaSoloSuPropiedad()
    {
        await ReadyAsync();
        SelectText(Georgia);

        Assert.IsFalse(_viewModel.SetTextFontFamily("Georgia"), "La misma fuente no se envía.");
        Assert.IsTrue(_viewModel.SetTextFontFamily("Segoe UI"));
        Assert.IsTrue(_viewModel.SetTextFontSize(30));
        Assert.IsFalse(_viewModel.SetTextFontSize(-2));
        Assert.IsTrue(_viewModel.SetTextFontWeight(700));
        Assert.IsTrue(_viewModel.SetTextItalic(true));
        Assert.IsTrue(_viewModel.SetTextAnchor(TextAnchor.Middle));
        Assert.IsFalse(_viewModel.SetTextAnchor(TextAnchor.Start), "La misma alineación no se envía.");
        Assert.IsTrue(_viewModel.SetTextLineHeight(1.5));
        _viewModel.ToggleBold();
        await _viewModel.EngineWork;

        Assert.AreEqual(
            string.Join(" | ", [
                """{"documentId":"d1","fontFamily":"Segoe UI"}""",
                """{"documentId":"d1","fontSize":30}""",
                """{"documentId":"d1","fontWeight":700}""",
                """{"documentId":"d1","italic":true}""",
                """{"documentId":"d1","anchor":"middle"}""",
                """{"documentId":"d1","lineHeight":1.5}""",
                """{"documentId":"d1","fontWeight":700}""",
            ]),
            string.Join(" | ", _engine.TextChanges));
    }

    [TestMethod]
    public async Task CtrlBYCtrlIDesdeElLienzoCambianLosTextos()
    {
        await ReadyAsync();
        SelectText(Georgia);
        await _viewModel.HandleShortcutAsync(new KeyboardShortcut("b", true, false, false));
        await _viewModel.HandleShortcutAsync(new KeyboardShortcut("i", true, false, false));
        await _viewModel.EngineWork;
        Assert.AreEqual(
            """{"documentId":"d1","fontWeight":700} | {"documentId":"d1","italic":true}""",
            string.Join(" | ", _engine.TextChanges));
    }

    [TestMethod]
    public void LaListaDeFuentesVaOrdenadaYSinRepetir()
    {
        _viewModel.SetSystemFonts(["Segoe UI", "arial", "Arial", "", "Consolas"]);
        Assert.AreEqual("arial | Consolas | Segoe UI", string.Join(" | ", _viewModel.SystemFonts));
    }
}
