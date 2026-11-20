using System.Text;
using WinVector.Core.Files;

namespace WinVector.Core.Tests.Files;

[TestClass]
public sealed class RecoveryStoreTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "winvector-recuperacion-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private RecoveryStore Started()
    {
        var store = new RecoveryStore(_root);
        store.StartSession();
        return store;
    }

    [TestMethod]
    public async Task UnaSesionQueTerminaDeFormaInesperadaSeOfreceAlArrancar()
    {
        var crashed = Started();
        var latin1 = new FileEncoding(Encoding.Latin1, false);
        await crashed.SaveAsync("a", "dibujo.svg", @"C:\dibujos\dibujo.svg", latin1, "<svg>ñ</svg>");
        // El proceso muere: su bloqueo se libera, pero su carpeta queda.
        crashed.Dispose();

        using var next = Started();
        var orphan = next.FindOrphans().Single();

        Assert.AreEqual("dibujo.svg", orphan.Title);
        Assert.AreEqual(@"C:\dibujos\dibujo.svg", orphan.FilePath);
        Assert.AreEqual("<svg>ñ</svg>", orphan.Svg);
        Assert.AreEqual(Encoding.Latin1.WebName, orphan.Encoding.Encoding.WebName);

        next.DiscardOrphans();
        Assert.IsEmpty(next.FindOrphans());
    }

    [TestMethod]
    public async Task NoOfreceLosDocumentosDeOtraVentanaAbierta()
    {
        using var running = Started();
        await running.SaveAsync("a", "abierto.svg", null, FileEncoding.Utf8, "<svg/>");

        using var other = Started();

        Assert.IsEmpty(other.FindOrphans());
        other.DiscardOrphans();
        Assert.IsTrue(Directory.Exists(running.SessionFolder), "No debe borrar la sesión de otra ventana abierta.");
    }

    [TestMethod]
    public async Task AlCerrarBienSeBorraLaSesion()
    {
        var store = Started();
        await store.SaveAsync("a", "x.svg", null, FileEncoding.Utf8, "<svg/>");
        var folder = store.SessionFolder;

        store.EndSession();
        store.Dispose();

        Assert.IsFalse(Directory.Exists(folder));
        using var next = Started();
        Assert.IsEmpty(next.FindOrphans());
    }

    [TestMethod]
    public async Task UnaCopiaQueLlegaTrasCerrarLaSesionNoSeEscribe()
    {
        var store = Started();
        var folder = store.SessionFolder;
        var saves = Enumerable.Range(0, 20)
            .Select(i => store.SaveAsync($"d{i}", "x.svg", null, FileEncoding.Utf8, new string('x', 100_000)))
            .ToList();

        // Cerrar espera a la copia en curso y las demás ya no se escriben: la carpeta desaparece entera.
        store.EndSession();
        await Task.WhenAll(saves);
        store.Dispose();
        await store.SaveAsync("tarde", "x.svg", null, FileEncoding.Utf8, "<svg/>");

        Assert.IsFalse(Directory.Exists(folder));
    }

    [TestMethod]
    public async Task BorrarUnaCopiaLaQuitaDeLasRecuperables()
    {
        var crashed = Started();
        await crashed.SaveAsync("a", "a.svg", null, FileEncoding.Utf8, "<svg/>");
        await crashed.SaveAsync("b", "b.svg", null, FileEncoding.Utf8, "<svg/>");
        await crashed.SaveAsync("b", "b2.svg", null, FileEncoding.Utf8, "<svg>2</svg>");
        crashed.Delete("a");
        crashed.Dispose();

        using var next = Started();
        var orphan = next.FindOrphans().Single();
        Assert.AreEqual("b2.svg", orphan.Title);
        Assert.AreEqual("<svg>2</svg>", orphan.Svg);
    }

    [TestMethod]
    public async Task UnaCopiaDanadaNoImpideRecuperarLasDemas()
    {
        var crashed = Started();
        await crashed.SaveAsync("buena", "buena.svg", null, FileEncoding.Utf8, "<svg/>");
        await File.WriteAllTextAsync(Path.Combine(crashed.SessionFolder!, "mala.json"), "{ no es json");
        await File.WriteAllTextAsync(Path.Combine(crashed.SessionFolder!, "mala.svg"), "<svg/>");
        crashed.Dispose();

        using var next = Started();
        Assert.AreEqual("buena.svg", next.FindOrphans().Single().Title);
    }
}
