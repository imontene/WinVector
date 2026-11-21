using WinVector.Core.Bridge;
using WinVector.Core.Shell;
using WinVector.Core.Tests.Bridge;

namespace WinVector.Core.Tests.Shell;

/// <summary>Operaciones del menú Trazado y regla de relleno en el panel (issue #79).</summary>
[TestClass]
public sealed class MainViewModelPathOperationsTests : IDisposable
{
    private readonly FakeBridgeTransport _transport = new();
    private readonly BridgeClient _bridge;
    private readonly IDisposable _attachment;
    private readonly MainViewModel _viewModel = new(TestTexts.Instance, new FakeDialogs());
    private readonly FakeEngine _engine;

    public MainViewModelPathOperationsTests()
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

    private void Select(string style) =>
        _transport.SendEvent(
            "selection.changed",
            $$"""{"documentId":"d1","items":[{"id":"a","tagName":"path"}],"bounds":{"x":0,"y":0,"width":10,"height":10},"scope":null,"style":{{style}}}""");

    [TestMethod]
    public async Task LasOperacionesNecesitanSeleccionYEnvianSuOperacion()
    {
        await ReadyAsync();
        Assert.IsFalse(_viewModel.CombinePathsCommand.CanExecute(null));

        Select("""{"fill":"#000000","stroke":"none","strokeWidth":1,"opacity":1,"fillRule":"nonzero"}""");
        Assert.IsTrue(_viewModel.ClosePathCommand.CanExecute(null));
        Assert.IsTrue(_viewModel.SeparatePathCommand.CanExecute(null));

        await _viewModel.ClosePathAsync();
        await _viewModel.OpenPathAsync();
        await _viewModel.ReversePathAsync();
        await _viewModel.CombinePathsAsync();
        await _viewModel.SeparatePathAsync();
        await _viewModel.EngineWork;
        Assert.AreEqual("close open reverse combine separate", string.Join(" ", _engine.NodeActions));
    }

    [TestMethod]
    public async Task LaReglaDeRellenoSeMuestraYSeCambia()
    {
        await ReadyAsync();
        Assert.AreEqual(-1, _viewModel.SelectionFillRuleIndex);

        Select("""{"fill":"#000000","stroke":"none","strokeWidth":1,"opacity":1,"fillRule":"nonzero"}""");
        Assert.AreEqual(FillRule.Nonzero, _viewModel.SelectionFillRule);
        Assert.AreEqual(0, _viewModel.SelectionFillRuleIndex);
        Assert.IsFalse(_viewModel.SetSelectionFillRule(FillRule.Nonzero), "Ya es esa: no se envía nada.");

        Assert.IsTrue(_viewModel.SetSelectionFillRule(FillRule.Evenodd));
        await _viewModel.EngineWork;
        StringAssert.Contains(_engine.StylesSet.Single(), "\"fillRule\":\"evenodd\"");

        // Reglas distintas: no se marca ninguna.
        Select("""{"fill":"#000000","stroke":"none","strokeWidth":1,"opacity":1}""");
        Assert.AreEqual(-1, _viewModel.SelectionFillRuleIndex);
    }

    [TestMethod]
    public void LasOperacionesEstanEnLaPaletaDeComandos()
    {
        foreach (var id in new[] { "path-close", "path-open", "path-reverse", "path-combine", "path-separate" })
        {
            Assert.IsTrue(_viewModel.Commands.All.Any(c => c.Id == id), id);
        }
    }
}
