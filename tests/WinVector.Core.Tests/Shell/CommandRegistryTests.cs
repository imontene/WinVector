using CommunityToolkit.Mvvm.Input;
using WinVector.Core.Shell;

namespace WinVector.Core.Tests.Shell;

[TestClass]
public sealed class CommandRegistryTests
{
    private static CommandRegistry Create(params (string Id, string Name)[] commands)
    {
        var registry = new CommandRegistry();
        foreach (var (id, name) in commands)
        {
            registry.Register(id, name, new RelayCommand(() => { }));
        }

        return registry;
    }

    private static string Names(IEnumerable<CommandEntry> entries) => string.Join(" | ", entries.Select(entry => entry.Name));

    [TestMethod]
    [DataRow("Ágrupación  Rápida", "agrupacion rapida")]
    [DataRow("Zoom: 100 %", "zoom 100")]
    [DataRow("Ñandú", "nandu")]
    public void NormalizaSinTildesNiMayusculas(string text, string expected) =>
        Assert.AreEqual(expected, CommandRegistry.Normalize(text));

    [TestMethod]
    public void BuscaSinTildesNiMayusculasYOrdenaPorParecido()
    {
        var registry = Create(("redo", "Rehacer"), ("undo", "Deshacer"), ("group", "Agrupación"), ("ungroup", "Desagrupar"));

        Assert.AreEqual("Deshacer", Names(registry.Search("DESHACER")));
        Assert.AreEqual("Agrupación", Names(registry.Search("agrupacion")));
        // "des" empieza dos nombres: van por orden de registro.
        Assert.AreEqual("Deshacer | Desagrupar", Names(registry.Search("des")));
        Assert.AreEqual("Agrupación | Desagrupar", Names(registry.Search("grup")));
    }

    [TestMethod]
    public void TambienBuscaPorElIdentificadorEnIngles()
    {
        var registry = Create(("undo", "Deshacer"), ("redo", "Rehacer"));
        Assert.AreEqual("Deshacer", Names(registry.Search("undo")));
    }

    [TestMethod]
    public void TodasLasPalabrasTienenQueAparecer()
    {
        var registry = Create(("zoom-fit", "Ajustar a la ventana"), ("zoom-in", "Acercar"));
        Assert.AreEqual("Ajustar a la ventana", Names(registry.Search("ajus vent")));
        Assert.IsEmpty(registry.Search("ajus nada"));
        Assert.IsEmpty(registry.Search("   "));
    }

    [TestMethod]
    public void SoloDevuelveLasOrdenesQueSePuedenEjecutar()
    {
        var registry = new CommandRegistry();
        var enabled = false;
        registry.Register("undo", "Deshacer", new RelayCommand(() => { }, () => enabled));
        Assert.IsEmpty(registry.Search("deshacer"));
        enabled = true;
        Assert.HasCount(1, registry.Search("deshacer"));
    }

    [TestMethod]
    public void NoAdmiteIdentificadoresRepetidos()
    {
        var registry = Create(("undo", "Deshacer"));
        Assert.ThrowsExactly<ArgumentException>(() => registry.Register("undo", "Otra", new RelayCommand(() => { })));
    }
}
