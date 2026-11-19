using System.Text;
using Microsoft.Extensions.Time.Testing;
using WinVector.Core.Bridge;
using WinVector.Core.Files;
using WinVector.Core.Shell;
using WinVector.Core.Tests.Bridge;

namespace WinVector.Core.Tests.Shell;

[TestClass]
public sealed class MainViewModelFileTests : IDisposable
{
    private const string Svg = """<svg xmlns="http://www.w3.org/2000/svg"><rect id="a"/></svg>""";

    private readonly string _folder = Directory.CreateTempSubdirectory("winvector-archivos-").FullName;
    private readonly FakeBridgeTransport _transport = new();
    private readonly FakeDialogs _dialogs = new();
    private readonly MainViewModel _viewModel;
    private readonly BridgeClient _bridge;
    private readonly IDisposable _attachment;
    private readonly FakeEngine _engine;

    public MainViewModelFileTests()
    {
        _viewModel = new MainViewModel(TestTexts.Instance, _dialogs, timeProvider: new FakeTimeProvider());
        _bridge = new BridgeClient(_transport);
        _attachment = _viewModel.AttachBridge(_bridge);
        _engine = new FakeEngine(_transport);
    }

    public void Dispose()
    {
        _attachment.Dispose();
        _bridge.Dispose();
        Directory.Delete(_folder, recursive: true);
    }

    private async Task ReadyAsync()
    {
        _engine.Ready();
        await _viewModel.EngineWork;
    }

    private string WriteFile(string name, string content = Svg)
    {
        var path = Path.Combine(_folder, name);
        File.WriteAllText(path, content);
        return path;
    }

    [TestMethod]
    public async Task AbrirUnArchivoSustituyeLaPestañaEnBlancoSinTocar()
    {
        await ReadyAsync();
        var path = WriteFile("dibujo.svg");

        var document = await _viewModel.OpenFileAsync(path);

        Assert.IsNotNull(document);
        Assert.AreEqual("dibujo.svg", document.Title);
        Assert.AreEqual(Path.GetFullPath(path), document.FilePath);
        Assert.IsTrue(document.IsLoaded);
        Assert.HasCount(1, _viewModel.Documents);
        Assert.AreSame(document, _viewModel.SelectedDocument);
        Assert.AreEqual(Path.GetFullPath(path), _viewModel.RecentFiles.Items[0]);
    }

    [TestMethod]
    public async Task NoSustituyeUnaPestañaConCambios()
    {
        await ReadyAsync();
        _engine.Modify("d1", "<svg/>");

        await _viewModel.OpenFileAsync(WriteFile("dibujo.svg"));

        Assert.HasCount(2, _viewModel.Documents);
    }

    [TestMethod]
    public async Task AbrirUnArchivoYaAbiertoActivaSuPestaña()
    {
        await ReadyAsync();
        var path = WriteFile("dibujo.svg");
        var first = await _viewModel.OpenFileAsync(path);
        _viewModel.NewDocument();
        await _viewModel.EngineWork;

        // Windows no distingue mayúsculas en las rutas: es el mismo archivo.
        var second = await _viewModel.OpenFileAsync(Path.Combine(_folder, "DIBUJO.svg"));

        Assert.AreSame(first, second);
        Assert.AreSame(first, _viewModel.SelectedDocument);
        Assert.HasCount(2, _viewModel.Documents);
    }

    [TestMethod]
    public async Task UnArchivoQueNoExisteMuestraElErrorYSaleDeRecientes()
    {
        await ReadyAsync();
        var path = Path.Combine(_folder, "borrado.svg");
        _viewModel.RecentFiles.Add(path);

        var document = await _viewModel.OpenFileAsync(path);

        Assert.IsNull(document);
        Assert.AreEqual(("No se pudo abrir", "NotFound: borrado.svg"), _dialogs.Errors.Single());
        Assert.IsEmpty(_viewModel.RecentFiles.Items);
    }

    [TestMethod]
    public async Task UnSvgNoValidoMuestraElErrorYNoDejaPestaña()
    {
        await ReadyAsync();
        _engine.InvalidSvgs.Add("<svg");

        var document = await _viewModel.OpenFileAsync(WriteFile("roto.svg", "<svg"));

        Assert.IsNull(document);
        Assert.AreEqual("SVG no válido en roto.svg: XML no válido", _dialogs.Errors.Single().Message);
        Assert.HasCount(1, _viewModel.Documents);
        Assert.IsNull(_viewModel.Documents[0].FilePath);
        Assert.IsEmpty(_viewModel.RecentFiles.Items);
    }

    [TestMethod]
    public async Task GuardarSinCambiosConservaLosBytes()
    {
        await ReadyAsync();
        var path = Path.Combine(_folder, "latin1.svg");
        var original = Encoding.Latin1.GetBytes("<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\r\n<svg xmlns=\"http://www.w3.org/2000/svg\"><text>Ñandú</text></svg>\r\n");
        await File.WriteAllBytesAsync(path, original);
        await _viewModel.OpenFileAsync(path);

        await _viewModel.SaveCommand.ExecuteAsync(null);

        CollectionAssert.AreEqual(original, await File.ReadAllBytesAsync(path));
    }

    [TestMethod]
    public async Task GuardarEscribeLosCambiosYQuitaLaMarcaDeModificado()
    {
        await ReadyAsync();
        var path = WriteFile("dibujo.svg");
        var document = await _viewModel.OpenFileAsync(path);
        Assert.IsNotNull(document);
        _engine.Modify(document.DocumentId, """<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>""");
        Assert.IsTrue(document.IsModified);
        Assert.AreEqual("dibujo.svg •", document.Header);

        Assert.IsTrue(await _viewModel.SaveDocumentAsync(document));

        Assert.IsFalse(document.IsModified);
        Assert.AreEqual("dibujo.svg", document.Header);
        StringAssert.Contains(await File.ReadAllTextAsync(path), "<circle/>");
        Assert.IsEmpty(_dialogs.Calls);
    }

    [TestMethod]
    public async Task GuardarUnDocumentoNuevoPideDondeYCambiaElTitulo()
    {
        await ReadyAsync();
        var path = Path.Combine(_folder, "nuevo.svg");
        _dialogs.SavePaths.Enqueue(path);

        await _viewModel.SaveCommand.ExecuteAsync(null);

        var document = _viewModel.Documents[0];
        Assert.AreEqual("guardar como Sin título 1.svg", _dialogs.Calls.Single());
        Assert.AreEqual("nuevo.svg", document.Title);
        Assert.AreEqual(path, document.FilePath);
        Assert.AreEqual(DocumentTemplates.Blank(), await File.ReadAllTextAsync(path));
    }

    [TestMethod]
    public async Task GuardarComoDejaIntactoElArchivoOriginal()
    {
        await ReadyAsync();
        var original = WriteFile("original.svg");
        var copy = Path.Combine(_folder, "copia.svg");
        var document = await _viewModel.OpenFileAsync(original);
        Assert.IsNotNull(document);
        _engine.Modify(document.DocumentId, "<svg>cambiado</svg>");
        _dialogs.SavePaths.Enqueue(copy);

        await _viewModel.SaveAsCommand.ExecuteAsync(null);

        Assert.AreEqual(Svg, await File.ReadAllTextAsync(original));
        Assert.AreEqual("<svg>cambiado</svg>", await File.ReadAllTextAsync(copy));
        Assert.AreEqual(copy, document.FilePath);
        Assert.AreEqual("guardar como original.svg", _dialogs.Calls.Single());
    }

    [TestMethod]
    public async Task CancelarElDialogoDeGuardarNoGuarda()
    {
        await ReadyAsync();
        _engine.Modify("d1", "<svg/>");

        Assert.IsFalse(await _viewModel.SaveDocumentAsync(_viewModel.Documents[0]));

        Assert.IsTrue(_viewModel.Documents[0].IsModified);
        Assert.IsEmpty(Directory.GetFiles(_folder));
    }

    [TestMethod]
    public async Task UnErrorAlGuardarSeMuestraYElDocumentoSigueModificado()
    {
        await ReadyAsync();
        _engine.Modify("d1", "<svg/>");
        _dialogs.SavePaths.Enqueue(Path.Combine(_folder, "no-existe", "dibujo.svg"));

        Assert.IsFalse(await _viewModel.SaveDocumentAsync(_viewModel.Documents[0]));

        Assert.AreEqual(("No se pudo guardar", "NotFound: dibujo.svg"), _dialogs.Errors.Single());
        Assert.IsTrue(_viewModel.Documents[0].IsModified);
    }

    [TestMethod]
    public async Task CerrarSinCambiosNoPregunta()
    {
        await ReadyAsync();
        _viewModel.NewDocument();

        Assert.IsTrue(await _viewModel.RequestCloseDocumentAsync(_viewModel.Documents[1]));

        Assert.IsEmpty(_dialogs.Calls);
        Assert.HasCount(1, _viewModel.Documents);
    }

    [TestMethod]
    [DataRow(UnsavedChangesChoice.Cancel, false, false)]
    [DataRow(UnsavedChangesChoice.DontSave, true, false)]
    [DataRow(UnsavedChangesChoice.Save, true, true)]
    public async Task CerrarConCambiosPregunta(UnsavedChangesChoice choice, bool closed, bool saved)
    {
        await ReadyAsync();
        var path = WriteFile("dibujo.svg");
        var document = await _viewModel.OpenFileAsync(path);
        Assert.IsNotNull(document);
        _engine.Modify(document.DocumentId, "<svg>cambiado</svg>");
        _dialogs.SaveChangesAnswers.Enqueue(choice);

        Assert.AreEqual(closed, await _viewModel.RequestCloseDocumentAsync(document));

        Assert.AreEqual("¿guardar dibujo.svg?", _dialogs.Calls.Single());
        Assert.AreEqual(closed, !_viewModel.Documents.Contains(document));
        Assert.AreEqual(saved, await File.ReadAllTextAsync(path) == "<svg>cambiado</svg>");
    }

    [TestMethod]
    public async Task SiSeCancelaGuardarAlCerrarLaPestañaSigueAbierta()
    {
        await ReadyAsync();
        _engine.Modify("d1", "<svg/>");
        _dialogs.SaveChangesAnswers.Enqueue(UnsavedChangesChoice.Save);

        Assert.IsFalse(await _viewModel.RequestCloseDocumentAsync(_viewModel.Documents[0]));

        Assert.HasCount(1, _viewModel.Documents);
    }

    [TestMethod]
    public async Task CerrarLaVentanaPreguntaPorCadaDocumentoConCambios()
    {
        await ReadyAsync();
        var path = WriteFile("dibujo.svg");
        var document = await _viewModel.OpenFileAsync(path);
        Assert.IsNotNull(document);
        _viewModel.NewDocument();
        await _viewModel.EngineWork;
        _engine.Modify(document.DocumentId, "<svg>a</svg>");
        _engine.Modify("d3", "<svg>b</svg>");
        _dialogs.SaveChangesAnswers.Enqueue(UnsavedChangesChoice.Save);
        _dialogs.SaveChangesAnswers.Enqueue(UnsavedChangesChoice.DontSave);

        Assert.IsTrue(await _viewModel.RequestCloseAllAsync());

        Assert.AreEqual("¿guardar dibujo.svg? | ¿guardar Sin título 2?", string.Join(" | ", _dialogs.Calls));
        Assert.AreEqual("<svg>a</svg>", await File.ReadAllTextAsync(path));
    }

    [TestMethod]
    public async Task CancelarAlCerrarLaVentanaLaMantieneAbierta()
    {
        await ReadyAsync();
        _engine.Modify("d1", "<svg/>");
        _dialogs.SaveChangesAnswers.Enqueue(UnsavedChangesChoice.Cancel);

        Assert.IsFalse(await _viewModel.RequestCloseAllAsync());
    }

    [TestMethod]
    public async Task NuevoConTamañoUsaLasUnidades()
    {
        await ReadyAsync();
        _dialogs.NewDocumentSize = new DocumentSize(210, 297, LengthUnit.Millimeters);

        await _viewModel.NewDocumentWithSizeCommand.ExecuteAsync(null);

        StringAssert.Contains(_engine.DocumentText("d2"), """width="210mm" height="297mm" viewBox="0 0 210 297""");
        Assert.AreEqual("Sin título 2", _viewModel.SelectedDocument?.Title);
    }

    [TestMethod]
    public async Task AbrirDesdeElDialogo()
    {
        await ReadyAsync();
        _dialogs.OpenPaths.Enqueue(WriteFile("dibujo.svg"));

        await _viewModel.OpenCommand.ExecuteAsync(null);

        Assert.AreEqual("dibujo.svg", _viewModel.SelectedDocument?.Title);
    }

    [TestMethod]
    public async Task UnArchivoAbiertoAntesDeQueCargueElMotorSeCargaAlCargar()
    {
        var document = await _viewModel.OpenFileAsync(WriteFile("dibujo.svg"));
        Assert.IsNotNull(document);

        await ReadyAsync();

        Assert.IsTrue(document.IsLoaded);
        Assert.AreEqual(document.DocumentId, _engine.ActiveDocument);
    }
}
