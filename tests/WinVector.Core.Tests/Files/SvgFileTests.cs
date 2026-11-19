using System.Text;
using WinVector.Core.Files;

namespace WinVector.Core.Tests.Files;

[TestClass]
public sealed class SvgFileTests : IDisposable
{
    private readonly string _folder = Directory.CreateTempSubdirectory("winvector-svgfile-").FullName;

    public void Dispose() => Directory.Delete(_folder, recursive: true);

    private string PathOf(string name) => Path.Combine(_folder, name);

    private static readonly byte[] Utf8Bom = [0xEF, 0xBB, 0xBF];

    public static IEnumerable<object[]> Samples =>
    [
        new object[] { "UTF-8 sin BOM", Encoding.UTF8.GetBytes("<svg xmlns=\"http://www.w3.org/2000/svg\"><text>ñ € 日本</text></svg>") },
        new object[] { "UTF-8 con BOM", Utf8Bom.Concat(Encoding.UTF8.GetBytes("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>")).ToArray() },
        new object[] { "UTF-16 LE con BOM", new byte[] { 0xFF, 0xFE }.Concat(Encoding.Unicode.GetBytes("<?xml version=\"1.0\" encoding=\"UTF-16\"?><svg xmlns=\"http://www.w3.org/2000/svg\"><text>ñ</text></svg>")).ToArray() },
        new object[] { "ISO-8859-1 declarado", Encoding.Latin1.GetBytes("<?xml version='1.0' encoding='ISO-8859-1'?>\r\n<svg xmlns=\"http://www.w3.org/2000/svg\"><text>Ñandú</text></svg>\r\n") },
    ];

    [TestMethod]
    [DynamicData(nameof(Samples))]
    public async Task LeerYGuardarSinCambiosConservaLosBytes(string name, byte[] original)
    {
        var path = PathOf($"{name}.svg");
        await File.WriteAllBytesAsync(path, original);

        var content = await SvgFile.ReadAsync(path);
        await SvgFile.WriteAsync(path, content.Text, content.Encoding);

        CollectionAssert.AreEqual(original, await File.ReadAllBytesAsync(path), name);
    }

    [TestMethod]
    public async Task DecodificaElTextoSegunSuCodificacion()
    {
        var path = PathOf("latin1.svg");
        await File.WriteAllBytesAsync(path, Encoding.Latin1.GetBytes("<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><svg><text>Ñandú</text></svg>"));

        var content = await SvgFile.ReadAsync(path);

        StringAssert.Contains(content.Text, "Ñandú");
        Assert.IsFalse(content.Encoding.HasByteOrderMark);
    }

    [TestMethod]
    public async Task ElTextoNoIncluyeLaMarcaBom()
    {
        var path = PathOf("bom.svg");
        await File.WriteAllBytesAsync(path, [.. Utf8Bom, .. Encoding.UTF8.GetBytes("<svg/>")]);

        var content = await SvgFile.ReadAsync(path);

        Assert.AreEqual("<svg/>", content.Text);
        Assert.IsTrue(content.Encoding.HasByteOrderMark);
    }

    [TestMethod]
    public async Task UnArchivoNuevoSeEscribeEnUtf8SinBom()
    {
        var path = PathOf("nuevo.svg");

        await SvgFile.WriteAsync(path, "<svg>ñ</svg>", FileEncoding.Utf8);

        CollectionAssert.AreEqual(Encoding.UTF8.GetBytes("<svg>ñ</svg>"), await File.ReadAllBytesAsync(path));
    }

    [TestMethod]
    public async Task NoDejaArchivosTemporales()
    {
        var path = PathOf("dibujo.svg");
        await SvgFile.WriteAsync(path, "<svg/>", FileEncoding.Utf8);
        await SvgFile.WriteAsync(path, "<svg><g/></svg>", FileEncoding.Utf8);

        Assert.AreEqual("dibujo.svg", string.Join(", ", Directory.GetFiles(_folder).Select(Path.GetFileName)));
    }

    [TestMethod]
    public async Task UnArchivoQueNoExisteDaNotFound()
    {
        var error = await Assert.ThrowsExactlyAsync<FileOperationException>(() => SvgFile.ReadAsync(PathOf("no-existe.svg")));
        Assert.AreEqual(FileErrorKind.NotFound, error.Kind);
    }

    [TestMethod]
    public async Task UnaCarpetaQueNoExisteDaNotFoundAlGuardar()
    {
        var error = await Assert.ThrowsExactlyAsync<FileOperationException>(
            () => SvgFile.WriteAsync(PathOf(Path.Combine("no", "existe.svg")), "<svg/>", FileEncoding.Utf8));
        Assert.AreEqual(FileErrorKind.NotFound, error.Kind);
    }

    [TestMethod]
    public async Task UnTextoQueNoEsUtf8ValidoDaInvalidEncoding()
    {
        var path = PathOf("roto.svg");
        await File.WriteAllBytesAsync(path, [0x3C, 0x73, 0x76, 0x67, 0xC3, 0x28, 0x2F, 0x3E]);

        var error = await Assert.ThrowsExactlyAsync<FileOperationException>(() => SvgFile.ReadAsync(path));
        Assert.AreEqual(FileErrorKind.InvalidEncoding, error.Kind);
    }

    [TestMethod]
    public async Task UnCaracterQueNoCabeEnLaCodificacionDaInvalidEncoding()
    {
        var path = PathOf("latin1.svg");
        await File.WriteAllBytesAsync(path, Encoding.Latin1.GetBytes("<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><svg/>"));
        var content = await SvgFile.ReadAsync(path);

        var error = await Assert.ThrowsExactlyAsync<FileOperationException>(
            () => SvgFile.WriteAsync(path, content.Text.Replace("<svg/>", "<svg>日本</svg>", StringComparison.Ordinal), content.Encoding));

        Assert.AreEqual(FileErrorKind.InvalidEncoding, error.Kind);
        StringAssert.Contains(await File.ReadAllTextAsync(path, Encoding.Latin1), "<svg/>");
    }
}
