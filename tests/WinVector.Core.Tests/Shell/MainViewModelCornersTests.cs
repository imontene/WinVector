using WinVector.Core.Bridge;
using WinVector.Core.Shell;
using WinVector.Core.Tests.Bridge;

namespace WinVector.Core.Tests.Shell;

/// <summary>Redondear todas las esquinas de las figuras seleccionadas a la vez (issue #114).</summary>
[TestClass]
public sealed class MainViewModelCornersTests : IDisposable
{
    private readonly FakeBridgeTransport _transport = new();
    private readonly BridgeClient _bridge;
    private readonly IDisposable _attachment;
    private readonly MainViewModel _viewModel = new(TestTexts.Instance, new FakeDialogs());
    private readonly FakeEngine _engine;

    public MainViewModelCornersTests()
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

    private void Select(string corners) =>
        _transport.SendEvent(
            "selection.changed",
            $$"""{"documentId":"d1","items":[{"id":"a","tagName":"polygon"},{"id":"b","tagName":"path"}],"bounds":{"x":0,"y":0,"width":10,"height":10},"scope":null{{corners}}}""");

    [TestMethod]
    public async Task ElRadioDeTodasLasEsquinasSeMuestraYSeEnviaConAll()
    {
        await ReadyAsync();
        Select(""","corners":{"radius":7.456}""");
        Assert.IsTrue(_viewModel.HasObjectCorners);
        Assert.AreEqual(7.46, _viewModel.ObjectCornerRadius);
        Assert.IsTrue(_viewModel.RoundCornersCommand.CanExecute(null));
        Assert.IsFalse(_viewModel.SetObjectCornerRadius(7.46), "El mismo radio no se envía.");
        Assert.IsFalse(_viewModel.SetObjectCornerRadius(-2));

        Assert.IsTrue(_viewModel.SetObjectCornerRadius(10));
        Assert.IsTrue(_viewModel.SetObjectCornerRadius(0));
        await _viewModel.EngineWork;
        Assert.AreEqual("radius 10 all radius 0 all", string.Join(" ", _engine.NodeActions));
    }

    [TestMethod]
    public async Task ConRadiosDistintosNoSeMuestraNingunoYSinEsquinasNoHayCampo()
    {
        await ReadyAsync();
        Select(""","corners":{}""");
        Assert.IsTrue(_viewModel.HasObjectCorners);
        Assert.IsTrue(double.IsNaN(_viewModel.ObjectCornerRadius));
        Assert.IsTrue(_viewModel.SetObjectCornerRadius(3), "Escribir un valor iguala los radios.");

        Select(string.Empty);
        Assert.IsFalse(_viewModel.HasObjectCorners);
        Assert.IsFalse(_viewModel.RoundCornersCommand.CanExecute(null));
        Assert.IsFalse(_viewModel.SetObjectCornerRadius(5));
    }

    [TestMethod]
    public async Task ConLaHerramientaVerticesElCampoEsElDeLasEsquinasSeleccionadas()
    {
        await ReadyAsync();
        Select(""","corners":{"radius":0}""");
        await _viewModel.SelectToolAsync(ToolName.Vertex);
        Assert.IsFalse(_viewModel.HasObjectCorners);
        Assert.IsFalse(_viewModel.RoundCornersCommand.CanExecute(null), "Sin esquinas seleccionadas no hay radio que cambiar.");

        _transport.SendEvent("nodes.changed", """{"documentId":"d1","count":1,"canSmooth":false,"canMakeLine":false,"canMakeCurve":false,"canRound":true,"cornerRadius":0}""");
        Assert.IsTrue(_viewModel.RoundCornersCommand.CanExecute(null));

        await _viewModel.SelectToolAsync(ToolName.Select);
        Assert.IsTrue(_viewModel.HasObjectCorners);
    }

    [TestMethod]
    public async Task RedondearEsquinasPideLlevarElFocoAlPanel()
    {
        await ReadyAsync();
        Select(""","corners":{"radius":0}""");
        var requested = 0;
        _viewModel.CornerRadiusRequested += (_, _) => requested++;
        _viewModel.RoundCornersCommand.Execute(null);
        Assert.AreEqual(1, requested);
        Assert.IsTrue(_viewModel.Commands.All.Any(c => c.Id == "path-round-corners"));
    }
}
