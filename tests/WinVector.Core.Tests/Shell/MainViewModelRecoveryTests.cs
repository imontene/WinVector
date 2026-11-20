using Microsoft.Extensions.Time.Testing;
using WinVector.Core.Bridge;
using WinVector.Core.Files;
using WinVector.Core.Shell;
using WinVector.Core.Tests.Bridge;

namespace WinVector.Core.Tests.Shell;

[TestClass]
public sealed class MainViewModelRecoveryTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "winvector-recuperacion-" + Guid.NewGuid().ToString("N"));
    private readonly string _folder = Path.Combine(Path.GetTempPath(), "winvector-archivos-" + Guid.NewGuid().ToString("N"));
    private readonly List<IDisposable> _disposables = [];
    private readonly FakeTimeProvider _time = new();
    private readonly FakeDialogs _dialogs = new();

    public MainViewModelRecoveryTests() => Directory.CreateDirectory(_folder);

    public void Dispose()
    {
        foreach (var disposable in Enumerable.Reverse(_disposables))
        {
            disposable.Dispose();
        }

        foreach (var folder in (string[])[_root, _folder])
        {
            if (Directory.Exists(folder))
            {
                Directory.Delete(folder, recursive: true);
            }
        }
    }

    private T Track<T>(T disposable)
        where T : IDisposable
    {
        _disposables.Add(disposable);
        return disposable;
    }

    /// <summary>Una ventana de la aplicación con su motor simulado y sus copias de recuperación.</summary>
    private async Task<(MainViewModel ViewModel, FakeEngine Engine, RecoveryStore Store)> StartAsync()
    {
        var transport = new FakeBridgeTransport();
        var store = Track(new RecoveryStore(_root, _time));
        var viewModel = new MainViewModel(TestTexts.Instance, _dialogs, timeProvider: _time, recovery: store);
        var bridge = Track(new BridgeClient(transport, timeProvider: _time));
        Track(viewModel.AttachBridge(bridge));
        var engine = new FakeEngine(transport);
        engine.Ready();
        await viewModel.EngineWork;
        viewModel.StartRecovery();
        return (viewModel, engine, store);
    }

    private static string RecoveryText(RecoveryStore store, DocumentTabViewModel document) =>
        File.ReadAllText(Path.Combine(store.SessionFolder!, document.RecoveryKey + ".svg"));

    private static bool HasRecovery(RecoveryStore store, DocumentTabViewModel document) =>
        File.Exists(Path.Combine(store.SessionFolder!, document.RecoveryKey + ".svg"));

    [TestMethod]
    public async Task GuardaUnaCopiaDeLosDocumentosConCambiosCadaPocoTiempo()
    {
        var (viewModel, engine, store) = await StartAsync();
        var document = viewModel.Documents[0];
        await viewModel.AutosaveAsync();
        Assert.IsFalse(HasRecovery(store, document), "Sin cambios no hace falta copia.");

        engine.Modify("d1", "<svg>1</svg>");
        _time.Advance(MainViewModel.RecoveryInterval);
        await WaitUntilAsync(() => HasRecovery(store, document));

        Assert.AreEqual("<svg>1</svg>", RecoveryText(store, document));
    }

    [TestMethod]
    public async Task GuardarODescartarBorraLaCopia()
    {
        var (viewModel, engine, store) = await StartAsync();
        var saved = viewModel.Documents[0];
        engine.Modify("d1", "<svg>1</svg>");
        viewModel.NewDocument();
        await viewModel.EngineWork;
        var discarded = viewModel.Documents[1];
        engine.Modify("d2", "<svg>2</svg>");
        await viewModel.AutosaveAsync();
        Assert.IsTrue(HasRecovery(store, saved));
        Assert.IsTrue(HasRecovery(store, discarded));

        _dialogs.SavePaths.Enqueue(Path.Combine(_folder, "guardado.svg"));
        Assert.IsTrue(await viewModel.SaveDocumentAsync(saved, chooseLocation: false));
        viewModel.CloseDocument(discarded);

        Assert.IsFalse(HasRecovery(store, saved), "Al guardar, la copia sobra.");
        Assert.IsFalse(HasRecovery(store, discarded), "Al descartar los cambios, la copia sobra.");
    }

    [TestMethod]
    public async Task TrasUnCierreInesperadoOfreceRecuperarLosDocumentosConSusCambios()
    {
        var (crashed, engine, store) = await StartAsync();
        var path = Path.Combine(_folder, "dibujo.svg");
        await File.WriteAllTextAsync(path, "<svg>original</svg>");
        var document = await crashed.OpenFileAsync(path);
        engine.Modify(document!.DocumentId, "<svg>con cambios</svg>");
        await crashed.AutosaveAsync();
        // El proceso muere sin cerrar la sesión.
        store.Dispose();

        var (viewModel, nextEngine, _) = await StartAsync();
        var recovered = await viewModel.OfferRecoveryAsync();
        await viewModel.EngineWork;

        Assert.AreEqual("¿recuperar dibujo.svg?", _dialogs.Calls.Last());
        var tab = recovered.Single();
        Assert.AreEqual("dibujo.svg", tab.Title);
        Assert.AreEqual(path, tab.FilePath);
        Assert.AreEqual("<svg>con cambios</svg>", nextEngine.DocumentText(tab.DocumentId));
        Assert.IsTrue(tab.IsModified, "Lo recuperado no está guardado en el archivo.");
        Assert.HasCount(1, viewModel.Documents, "La pestaña nueva vacía se sustituye.");
    }

    [TestMethod]
    public async Task SiNoSeQuiereRecuperarSeDescartan()
    {
        var (crashed, engine, store) = await StartAsync();
        engine.Modify("d1", "<svg>1</svg>");
        await crashed.AutosaveAsync();
        store.Dispose();
        _dialogs.RecoverAnswer = false;

        var (viewModel, _, _) = await StartAsync();
        Assert.IsEmpty(await viewModel.OfferRecoveryAsync());
        _dialogs.Calls.Clear();

        var (third, _, _) = await StartAsync();
        Assert.IsEmpty(await third.OfferRecoveryAsync());
        Assert.IsEmpty(_dialogs.Calls, "Lo descartado no se vuelve a ofrecer.");
        Assert.HasCount(1, viewModel.Documents);
    }

    [TestMethod]
    public async Task SiElMotorFallaLosDocumentosVuelvenDesdeSuUltimaCopia()
    {
        var (viewModel, engine, _) = await StartAsync();
        var document = viewModel.Documents[0];
        engine.Modify("d1", "<svg>copia</svg>");
        await viewModel.AutosaveAsync();
        engine.Modify("d1", "<svg>después de la copia</svg>");

        viewModel.OnEngineFailed(reloading: true);
        Assert.IsFalse(viewModel.IsEngineReady);
        Assert.AreEqual("Recargado", _dialogs.Errors.Single().Message);

        // El lienzo se recarga y el motor se vuelve a anunciar.
        engine.Ready();
        await viewModel.EngineWork;

        Assert.AreEqual("<svg>copia</svg>", engine.DocumentText("d1"));
        Assert.IsTrue(document.IsLoaded);
        Assert.IsTrue(document.IsModified);
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        for (var i = 0; i < 200 && !condition(); i++)
        {
            await Task.Delay(10);
        }

        Assert.IsTrue(condition());
    }
}
