using WinVector.Core.Shell;

namespace WinVector.Core.Tests.Shell;

[TestClass]
public sealed class DocumentTemplatesTests
{
    [TestMethod]
    [DataRow(800, 600, LengthUnit.Pixels, """width="800" height="600" viewBox="0 0 800 600""")]
    [DataRow(210, 297, LengthUnit.Millimeters, """width="210mm" height="297mm" viewBox="0 0 210 297""")]
    [DataRow(8.5, 11, LengthUnit.Inches, """width="8.5in" height="11in" viewBox="0 0 816 1056""")]
    public void UsaLasUnidadesIndicadas(double width, double height, LengthUnit unit, string expected)
    {
        StringAssert.Contains(DocumentTemplates.Blank(new DocumentSize(width, height, unit)), expected);
    }

    [TestMethod]
    public void RechazaTamañosNoPositivos()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => DocumentTemplates.Blank(new DocumentSize(0, 10, LengthUnit.Pixels)));
    }
}
