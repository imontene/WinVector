using WinVector.Core.Bridge;
using WinVector.Core.Shell;
using WinVector.Core.Tests.Bridge;

namespace WinVector.Core.Tests.Shell;

/// <summary>Degradados del relleno y del trazo en el panel Apariencia (issue #109).</summary>
[TestClass]
public sealed class MainViewModelGradientsTests : IDisposable
{
    private const string TwoStops = """[{"offset":0,"color":"#ff0000","opacity":1},{"offset":1,"color":"#0000ff","opacity":0.5}]""";

    private readonly FakeBridgeTransport _transport = new();
    private readonly BridgeClient _bridge;
    private readonly IDisposable _attachment;
    private readonly MainViewModel _viewModel = new(TestTexts.Instance, new FakeDialogs());
    private readonly FakeEngine _engine;

    public MainViewModelGradientsTests()
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
            $$"""{"documentId":"d1","items":[{"id":"a","tagName":"rect"}],"bounds":{"x":0,"y":0,"width":10,"height":10},"scope":null,"style":{{style}}}""");

    private void SelectGradient(string kind = "linear", string stops = TwoStops, string spread = "pad") =>
        Select($$$"""{"fill":"url","stroke":"none","strokeWidth":1,"opacity":1,"fillGradient":{"id":"g","kind":"{{{kind}}}","spread":"{{{spread}}}","stops":{{{stops}}},"users":1}}""");

    private GradientEditorViewModel Fill => _viewModel.FillGradient;

    [TestMethod]
    public async Task UnColorSeMuestraEnModoColorYUnDegradadoConSusParadas()
    {
        await ReadyAsync();
        Select("""{"fill":"#ff0000","stroke":"none","strokeWidth":1,"opacity":1}""");
        Assert.AreEqual(PaintMode.Color, Fill.Mode);
        Assert.IsFalse(Fill.IsGradient);
        Assert.AreEqual(PaintMode.Color, _viewModel.StrokeGradient.Mode);

        SelectGradient("radial", spread: "reflect");
        Assert.AreEqual(PaintMode.Radial, Fill.Mode);
        Assert.AreEqual(2, Fill.ModeIndex);
        Assert.AreEqual(SpreadMethod.Reflect, Fill.Spread);
        Assert.AreEqual(2, Fill.Stops.Count);
        Assert.AreEqual(0, Fill.SelectedIndex);
        Assert.AreEqual(2, Fill.StopLabels.Count);

        // Varios objetos con pinturas distintas, o un patrón: ningún modo.
        Select("""{"fill":"url","stroke":"none","strokeWidth":1,"opacity":1}""");
        Assert.IsNull(Fill.Mode);
        Assert.AreEqual(-1, Fill.ModeIndex);
    }

    [TestMethod]
    public async Task ElegirLinealORadialPideElDegradadoYColorVuelveAlColorDeLaParada()
    {
        await ReadyAsync();
        Select("""{"fill":"#ff0000","stroke":"none","strokeWidth":1,"opacity":1}""");
        Assert.IsTrue(Fill.SetMode(PaintMode.Linear));
        Assert.IsTrue(_viewModel.StrokeGradient.SetMode(PaintMode.Radial));
        await _viewModel.EngineWork;
        Assert.AreEqual(
            """{"documentId":"d1","property":"fill","kind":"linear"} {"documentId":"d1","property":"stroke","kind":"radial"}""",
            string.Join(" ", _engine.Gradients));

        SelectGradient();
        Fill.SelectStop(1);
        Assert.IsTrue(Fill.SetMode(PaintMode.Color));
        await _viewModel.EngineWork;
        StringAssert.Contains(_engine.StylesSet.Last(), "\"fill\":\"#0000ff\"");
        Assert.AreEqual(PaintMode.Color, Fill.Mode);
    }

    [TestMethod]
    public async Task MoverUnaParadaMasAllaDeOtraLasReordenaYSigueElegida()
    {
        await ReadyAsync();
        SelectGradient();
        Assert.IsTrue(Fill.MoveStop(0, 0.75));
        Assert.AreEqual(0.75, Fill.Stops[0].Offset);
        Assert.AreEqual(0, Fill.SelectedIndex);

        Assert.IsTrue(Fill.MoveStop(0, 1.2));
        Assert.AreEqual("#0000ff", Fill.Stops[0].Color);
        Assert.AreEqual("#ff0000", Fill.Stops[1].Color);
        Assert.AreEqual(1, Fill.Stops[1].Offset);
        Assert.AreEqual(1, Fill.SelectedIndex, "La parada movida sigue elegida en su nuevo lugar.");
        Assert.AreEqual(100, Fill.SelectedOffsetPercent);
        Assert.IsFalse(Fill.MoveStop(1, 1), "Sin cambio no se envía nada.");

        Assert.IsTrue(Fill.SetSelectedOffsetPercent(25));
        Assert.AreEqual(0.25, Fill.Stops[0].Offset);
        Assert.AreEqual("#ff0000", Fill.Stops[0].Color);
        await _viewModel.EngineWork;
        Assert.AreEqual(3, _engine.Gradients.Count);
    }

    [TestMethod]
    public async Task AnadirUnaParadaMezclaLosColoresYQuitarlaDejaAlMenosDos()
    {
        await ReadyAsync();
        SelectGradient();
        Assert.IsFalse(Fill.RemoveStopCommand.CanExecute(null));
        Assert.IsTrue(Fill.AddStopAt(0.5));
        Assert.AreEqual(3, Fill.Stops.Count);
        Assert.AreEqual(1, Fill.SelectedIndex);
        Assert.AreEqual(new GradientStop(0.5, "#800080", 0.75), Fill.Stops[1]);
        Assert.IsTrue(Fill.RemoveStopCommand.CanExecute(null));

        Fill.RemoveStopCommand.Execute(null);
        Assert.AreEqual(2, Fill.Stops.Count);
        Assert.IsFalse(Fill.RemoveStopCommand.CanExecute(null));

        // Sin posición: a mitad de camino hacia la siguiente.
        Fill.SelectStop(0);
        Fill.AddStopCommand.Execute(null);
        Assert.AreEqual(0.5, Fill.Stops[1].Offset);
    }

    [TestMethod]
    public async Task ColorDeLaParadaInvertirYRepeticion()
    {
        await ReadyAsync();
        SelectGradient();
        Fill.SelectStop(1);
        Assert.IsTrue(Fill.SetSelectedColor("#00FF00", 0.25));
        Assert.AreEqual(new GradientStop(1, "#00ff00", 0.25), Fill.Stops[1]);
        Assert.IsFalse(Fill.SetSelectedColor("#00ff00", 0.25));
        Assert.IsFalse(Fill.SetSelectedColor("verde", 1));

        Fill.InvertCommand.Execute(null);
        Assert.AreEqual(new GradientStop(0, "#00ff00", 0.25), Fill.Stops[0]);
        Assert.AreEqual(new GradientStop(1, "#ff0000", 1), Fill.Stops[1]);
        Assert.AreEqual(0, Fill.SelectedIndex, "La parada elegida sigue elegida.");

        Assert.IsTrue(Fill.SetSpread(SpreadMethod.Repeat));
        Assert.IsFalse(Fill.SetSpread(SpreadMethod.Repeat));
        await _viewModel.EngineWork;
        StringAssert.Contains(_engine.Gradients.Last(), "\"spread\":\"repeat\"");
    }

    [TestMethod]
    public async Task SinSeleccionNoSeEnviaNada()
    {
        await ReadyAsync();
        Assert.IsFalse(Fill.SetMode(PaintMode.Linear));
        Assert.IsFalse(Fill.AddStopAt(0.5));
        await _viewModel.EngineWork;
        Assert.AreEqual(0, _engine.Gradients.Count);
    }

    private void SelectShared(int stopsUsers) =>
        Select($$$"""{"fill":"url","stroke":"none","strokeWidth":1,"opacity":1,"fillGradient":{"id":"g-2","kind":"linear","spread":"pad","stops":{{{TwoStops}}},"users":1,"stopsId":"g","stopsUsers":{{{stopsUsers}}}}}""");

    [TestMethod]
    public async Task LaBibliotecaDelDocumentoSeMuestraYSeAplica()
    {
        await ReadyAsync();
        _transport.SendEvent("document.gradients", $$"""{"documentId":"d1","gradients":[{"id":"cielo","kind":"linear","spread":"pad","stops":{{TwoStops}},"users":2}]}""");
        Assert.AreEqual("cielo", Fill.Library.Single().Id);
        Assert.AreEqual("cielo", _viewModel.StrokeGradient.Library.Single().Id);

        Select("""{"fill":"#ff0000","stroke":"none","strokeWidth":1,"opacity":1}""");
        Assert.IsTrue(Fill.ApplyLibrary("cielo"));
        Assert.IsTrue(Fill.ApplyPreset(GradientPreset.All[2]));
        await _viewModel.EngineWork;
        StringAssert.StartsWith(_engine.Gradients[0], """use {"documentId":"d1","property":"fill","id":"cielo"}""");
        StringAssert.Contains(_engine.Gradients[1], "\"kind\":\"linear\"");
        StringAssert.Contains(_engine.Gradients[1], "#ff7e5f");

        // Otro documento no tiene biblioteca.
        _viewModel.NewDocument();
        await _viewModel.EngineWork;
        Assert.AreEqual(0, Fill.Library.Count);
    }

    [TestMethod]
    public async Task ConParadasCompartidasSePuedenCambiarParaTodosODuplicar()
    {
        await ReadyAsync();
        SelectShared(1);
        Assert.IsFalse(Fill.CanEditShared, "Si solo lo usa este objeto, no hay nada que compartir.");
        Assert.IsFalse(Fill.DuplicateCommand.CanExecute(null));

        SelectShared(3);
        Assert.IsTrue(Fill.CanEditShared);
        Fill.EditShared = true;
        Assert.IsTrue(Fill.MoveStop(0, 0.5));
        Fill.EditShared = false;
        Assert.IsTrue(Fill.MoveStop(0, 0.25));
        Fill.DuplicateCommand.Execute(null);
        await _viewModel.EngineWork;
        StringAssert.Contains(_engine.Gradients[0], "\"shared\":true");
        Assert.IsFalse(_engine.Gradients[1].Contains("shared", StringComparison.Ordinal));
        Assert.AreEqual("""use {"documentId":"d1","property":"fill","id":"g","copy":true}""", _engine.Gradients[2]);

        // Otra selección con otras paradas: vuelve a editar solo el objeto.
        Fill.EditShared = true;
        Select("""{"fill":"#ff0000","stroke":"none","strokeWidth":1,"opacity":1}""");
        Assert.IsFalse(Fill.EditShared);
    }

    [TestMethod]
    public async Task LaHerramientaDegradadoEstaEnLaPaletaYSeElige()
    {
        await ReadyAsync();
        var entry = _viewModel.Commands.All.Single(c => c.Id == "tool-gradient");
        entry.Execute();
        await _viewModel.EngineWork;
        Assert.AreEqual(ToolName.Gradient, _viewModel.ActiveTool);
    }

    [TestMethod]
    public void LosPredefinidosTienenAlMenosDosParadasOrdenadas()
    {
        foreach (var preset in GradientPreset.All)
        {
            Assert.IsTrue(preset.Stops.Count >= 2, preset.Key);
            Assert.IsTrue(preset.Stops.Zip(preset.Stops.Skip(1)).All(pair => pair.First.Offset <= pair.Second.Offset), preset.Key);
        }
    }
}
