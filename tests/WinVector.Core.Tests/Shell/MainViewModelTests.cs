using WinVector.Core.Shell;

namespace WinVector.Core.Tests.Shell;

[TestClass]
public sealed class MainViewModelTests
{
    internal static readonly TestTexts Texts = TestTexts.Instance;

    private static MainViewModel Create() => new(Texts);

    [TestMethod]
    public void EmpiezaConUnDocumentoNuevoActivo()
    {
        var viewModel = Create();

        Assert.HasCount(1, viewModel.Documents);
        Assert.AreEqual("Sin título 1", viewModel.Documents[0].Title);
        Assert.AreSame(viewModel.Documents[0], viewModel.SelectedDocument);
    }

    [TestMethod]
    public void NuevoDocumentoSeAñadeAlFinalYSeActiva()
    {
        var viewModel = Create();

        viewModel.NewDocumentCommand.Execute(null);

        Assert.HasCount(2, viewModel.Documents);
        Assert.AreEqual("Sin título 2", viewModel.Documents[1].Title);
        Assert.AreSame(viewModel.Documents[1], viewModel.SelectedDocument);
    }

    [TestMethod]
    public void CerrarLaPestañaActivaActivaLaSiguiente()
    {
        var viewModel = Create();
        viewModel.NewDocument();
        viewModel.NewDocument();
        var (first, second, third) = (viewModel.Documents[0], viewModel.Documents[1], viewModel.Documents[2]);
        viewModel.SelectedDocument = second;

        viewModel.CloseDocumentCommand.Execute(second);

        CollectionAssert.AreEqual(new[] { first, third }, viewModel.Documents);
        Assert.AreSame(third, viewModel.SelectedDocument);
    }

    [TestMethod]
    public void CerrarLaUltimaPestañaActivaLaAnterior()
    {
        var viewModel = Create();
        viewModel.NewDocument();
        var first = viewModel.Documents[0];

        viewModel.CloseDocument(viewModel.Documents[1]);

        Assert.AreSame(first, viewModel.SelectedDocument);
    }

    [TestMethod]
    public void CerrarUnaPestañaInactivaNoCambiaLaActiva()
    {
        var viewModel = Create();
        viewModel.NewDocument();
        var active = viewModel.Documents[1];

        viewModel.CloseDocument(viewModel.Documents[0]);

        Assert.AreSame(active, viewModel.SelectedDocument);
    }

    [TestMethod]
    public void CerrarLaUnicaPestañaAbreUnDocumentoNuevo()
    {
        var viewModel = Create();

        viewModel.CloseDocument(viewModel.Documents[0]);

        Assert.HasCount(1, viewModel.Documents);
        Assert.AreEqual("Sin título 2", viewModel.Documents[0].Title);
        Assert.AreSame(viewModel.Documents[0], viewModel.SelectedDocument);
    }

    [TestMethod]
    public void CerrarUnaPestañaDesconocidaNoHaceNada()
    {
        var viewModel = Create();

        viewModel.CloseDocument(new DocumentTabViewModel("x", "Otra", "<svg/>"));
        viewModel.CloseDocument(null);

        Assert.HasCount(1, viewModel.Documents);
    }
}
