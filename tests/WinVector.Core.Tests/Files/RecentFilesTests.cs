using WinVector.Core.Files;

namespace WinVector.Core.Tests.Files;

[TestClass]
public sealed class RecentFilesTests
{
    private sealed class MemoryStore : IRecentFilesStore
    {
        public List<string> Saved { get; } = [];

        public IReadOnlyList<string> Load() => Saved.ToArray();

        public void Save(IReadOnlyList<string> paths)
        {
            Saved.Clear();
            Saved.AddRange(paths);
        }
    }

    [TestMethod]
    public void ElMasRecientePrimeroSinRepetidos()
    {
        var store = new MemoryStore();
        var recent = new RecentFiles(store);

        recent.Add(@"C:\a.svg");
        recent.Add(@"C:\b.svg");
        recent.Add(@"c:\A.SVG");

        Assert.AreEqual(@"c:\A.SVG | C:\b.svg", string.Join(" | ", recent.Items));
        Assert.AreEqual(@"c:\A.SVG | C:\b.svg", string.Join(" | ", store.Saved));
    }

    [TestMethod]
    public void NoPasaDeLaCapacidad()
    {
        var recent = new RecentFiles(new MemoryStore(), capacity: 3);

        foreach (var name in new[] { "1", "2", "3", "4" })
        {
            recent.Add($@"C:\{name}.svg");
        }

        Assert.AreEqual(@"C:\4.svg | C:\3.svg | C:\2.svg", string.Join(" | ", recent.Items));
    }

    [TestMethod]
    public void CargaLaListaGuardada()
    {
        var store = new MemoryStore();
        store.Saved.AddRange([@"C:\x.svg", @"C:\y.svg"]);

        var recent = new RecentFiles(store);

        Assert.HasCount(2, recent.Items);
    }

    [TestMethod]
    public void QuitarYVaciar()
    {
        var store = new MemoryStore();
        var recent = new RecentFiles(store);
        recent.Add(@"C:\a.svg");
        recent.Add(@"C:\b.svg");

        recent.Remove(@"C:\A.svg");
        Assert.AreEqual(@"C:\b.svg", string.Join(" | ", store.Saved));

        recent.Clear();
        Assert.IsEmpty(store.Saved);
    }

    [TestMethod]
    public void ElAlmacenDeTextoGuardaYCarga()
    {
        var folder = Directory.CreateTempSubdirectory("winvector-recientes-").FullName;
        try
        {
            var store = new TextFileRecentFilesStore(Path.Combine(folder, "sub", "recientes.txt"));
            store.Save([@"C:\a.svg", @"D:\b c.svg"]);

            Assert.AreEqual(@"C:\a.svg | D:\b c.svg", string.Join(" | ", new TextFileRecentFilesStore(Path.Combine(folder, "sub", "recientes.txt")).Load()));
        }
        finally
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    [TestMethod]
    public void UnAlmacenIlegibleDevuelveUnaListaVacia()
    {
        var folder = Directory.CreateTempSubdirectory("winvector-recientes-").FullName;
        try
        {
            // Una carpeta con el nombre del archivo hace fallar la lectura.
            Directory.CreateDirectory(Path.Combine(folder, "recientes.txt"));
            Assert.IsEmpty(new TextFileRecentFilesStore(Path.Combine(folder, "recientes.txt")).Load());
        }
        finally
        {
            Directory.Delete(folder, recursive: true);
        }
    }
}
