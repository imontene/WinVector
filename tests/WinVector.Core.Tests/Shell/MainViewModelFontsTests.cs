using WinVector.Core.Bridge;
using WinVector.Core.Shell;
using WinVector.Core.Tests.Bridge;

namespace WinVector.Core.Tests.Shell;

/// <summary>Aviso de fuentes que faltan (issue #97).</summary>
[TestClass]
public sealed class MainViewModelFontsTests : IDisposable
{
    private readonly FakeBridgeTransport _transport = new();
    private readonly BridgeClient _bridge;
    private readonly IDisposable _attachment;
    private readonly MainViewModel _viewModel = new(TestTexts.Instance, new FakeDialogs());
    private readonly FakeEngine _engine;

    public MainViewModelFontsTests()
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

    private void Fonts(string documentId, string fonts) =>
        _transport.SendEvent("document.fonts", $$"""{"documentId":"{{documentId}}","fonts":{{fonts}}}""");

    private const string Uses =
        """[{"families":["Fuente Rara","Georgia","serif"]},{"families":["Otra Rara","sans-serif"]},{"families":["Nada"]},{"families":["Georgia","serif"]},{"families":["serif"]}]""";

    [TestMethod]
    public async Task AvisaDeLasFuentesQueNoEstanInstaladasYConCualSeVen()
    {
        await ReadyAsync();
        _viewModel.SetSystemFonts(["Georgia", "Segoe UI"]);
        Fonts("d1", Uses);

        Assert.IsTrue(_viewModel.HasMissingFonts);
        Assert.AreEqual("Faltan: Fuente Rara → Georgia, Otra Rara → sans-serif, Nada → ?", _viewModel.MissingFontsMessage);

        // De otro documento no se avisa aquí.
        Fonts("otro", """[{"families":["X"]}]""");
        Assert.AreEqual("Faltan: Fuente Rara → Georgia, Otra Rara → sans-serif, Nada → ?", _viewModel.MissingFontsMessage);
    }

    [TestMethod]
    public async Task SinLaListaDeFuentesNoSeAvisaYConTodasInstaladasTampoco()
    {
        await ReadyAsync();
        Fonts("d1", Uses);
        Assert.IsFalse(_viewModel.HasMissingFonts, "Sin conocer las fuentes instaladas no se avisa.");

        _viewModel.SetSystemFonts(["Georgia", "Fuente Rara", "Otra Rara", "Nada"]);
        Assert.IsFalse(_viewModel.HasMissingFonts);
    }

    [TestMethod]
    public async Task CerrarElAvisoLoQuitaHastaQueFalteOtraFuente()
    {
        await ReadyAsync();
        _viewModel.SetSystemFonts(["Georgia"]);
        Fonts("d1", """[{"families":["Rara"]}]""");
        _viewModel.DismissMissingFonts();
        Assert.IsFalse(_viewModel.HasMissingFonts);

        Fonts("d1", """[{"families":["Rara"]}]""");
        Assert.IsFalse(_viewModel.HasMissingFonts, "El mismo aviso no vuelve.");

        Fonts("d1", """[{"families":["Rara"]},{"families":["Otra"]}]""");
        Assert.IsTrue(_viewModel.HasMissingFonts, "Falta otra fuente: el aviso vuelve.");
    }

    [TestMethod]
    public async Task ElPanelMarcaLaFuenteDelTextoQueNoEstaInstalada()
    {
        await ReadyAsync();
        _viewModel.SetSystemFonts(["Georgia"]);
        _transport.SendEvent(
            "selection.changed",
            """{"documentId":"d1","items":[{"id":null,"tagName":"text"}],"bounds":{"x":0,"y":0,"width":10,"height":10},"scope":null,"text":{"fontFamily":"Rara","fontSize":10,"fontWeight":400,"italic":false,"anchor":"start","lineHeight":1.2}}""");
        Assert.IsTrue(_viewModel.IsTextFontMissing);

        _transport.SendEvent(
            "selection.changed",
            """{"documentId":"d1","items":[{"id":null,"tagName":"text"}],"bounds":{"x":0,"y":0,"width":10,"height":10},"scope":null,"text":{"fontFamily":"georgia","fontSize":10,"fontWeight":400,"italic":false,"anchor":"start","lineHeight":1.2}}""");
        Assert.IsFalse(_viewModel.IsTextFontMissing);
    }
}
