using WinVector.Core.Shell;

namespace WinVector.Core.Tests.Shell;

[TestClass]
public sealed class CommandLineTests
{
    [TestMethod]
    [DataRow(null, "")]
    [DataRow("", "")]
    [DataRow("   ", "")]
    [DataRow("dibujo.svg", "dibujo.svg")]
    [DataRow(@"""C:\Mis dibujos\logo.svg"" otro.svg", @"C:\Mis dibujos\logo.svg | otro.svg")]
    [DataRow(@"  a.svg   ""b c.svg""  ", "a.svg | b c.svg")]
    [DataRow(@"""""", "")]
    public void SeparaLosArgumentos(string? commandLine, string expected)
    {
        Assert.AreEqual(expected, string.Join(" | ", CommandLine.SplitArguments(commandLine)));
    }
}
