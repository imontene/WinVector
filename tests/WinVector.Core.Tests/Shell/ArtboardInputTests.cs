using WinVector.Core.Bridge;
using WinVector.Core.Shell;

namespace WinVector.Core.Tests.Shell;

[TestClass]
public sealed class ArtboardInputTests
{
    [TestMethod]
    [DataRow("800", "800")]
    [DataRow(" 210 mm ", "210mm")]
    [DataRow("1.5IN", "1.5in")]
    [DataRow("100%", "100%")]
    [DataRow(".5e2px", ".5e2px")]
    [DataRow("", null)]
    public void AceptaLongitudesSvg(string text, string? expected)
    {
        Assert.IsTrue(ArtboardInput.TryParseLength(text, out var length));
        Assert.AreEqual(expected, length);
    }

    [TestMethod]
    [DataRow("0")]
    [DataRow("-5")]
    [DataRow("10 metros")]
    [DataRow("abc")]
    public void RechazaLongitudesNoValidas(string text) =>
        Assert.IsFalse(ArtboardInput.TryParseLength(text, out _));

    [TestMethod]
    public void LeeYEscribeElViewBox()
    {
        Assert.IsTrue(ArtboardInput.TryParseViewBox("-10, 0  400\t300.5", out var box));
        Assert.AreEqual(new Rect(-10, 0, 400, 300.5), box);
        Assert.AreEqual("-10 0 400 300.5", ArtboardInput.Format(box));
        Assert.IsTrue(ArtboardInput.TryParseViewBox(" ", out var none));
        Assert.IsNull(none);
        Assert.IsFalse(ArtboardInput.TryParseViewBox("0 0 0 10", out _));
        Assert.IsFalse(ArtboardInput.TryParseViewBox("0 0 1 2 3", out _));
    }
}
