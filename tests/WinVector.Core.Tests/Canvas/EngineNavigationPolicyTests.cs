using WinVector.Core.Canvas;

namespace WinVector.Core.Tests.Canvas;

[TestClass]
public sealed class EngineNavigationPolicyTests
{
    [TestMethod]
    [DataRow("https://engine.winvector/index.html")]
    [DataRow("https://engine.winvector/assets/index-1jLhyCnX.js")]
    [DataRow("https://ENGINE.WINVECTOR/index.html#sol")]
    public void PermiteLasPaginasDelMotor(string uri)
    {
        Assert.AreEqual(EngineNavigationDecision.Allow, EngineNavigationPolicy.Decide(uri));
    }

    [TestMethod]
    [DataRow("https://example.com/")]
    [DataRow("http://example.com/ayuda")]
    [DataRow("http://engine.winvector/index.html")]
    [DataRow("https://engine.winvector.example.com/")]
    [DataRow("https://engine.winvector:8443/index.html")]
    public void AbreFueraLosEnlacesWeb(string uri)
    {
        Assert.AreEqual(EngineNavigationDecision.OpenExternally, EngineNavigationPolicy.Decide(uri));
    }

    [TestMethod]
    [DataRow("file:///C:/Users/ana/secreto.txt")]
    [DataRow("javascript:alert(1)")]
    [DataRow("ms-settings:privacy")]
    [DataRow("about:blank")]
    [DataRow("https://usuario@engine.winvector/index.html")]
    [DataRow("index.html")]
    [DataRow("")]
    [DataRow(null)]
    public void BloqueaElResto(string? uri)
    {
        Assert.AreEqual(EngineNavigationDecision.Block, EngineNavigationPolicy.Decide(uri));
    }

    [TestMethod]
    public void LaPaginaDeEntradaEstaPermitida()
    {
        Assert.AreEqual(EngineNavigationDecision.Allow, EngineNavigationPolicy.Decide(EngineLocation.EntryPage));
    }
}
