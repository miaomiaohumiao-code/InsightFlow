$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sampleRoot = Split-Path -Parent $PSScriptRoot
$sampleArchive = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $sampleRoot '样例数据.docx'))
try {
  $sampleReader = [System.IO.StreamReader]::new($sampleArchive.GetEntry('word/document.xml').Open())
  try { $sampleXml = [xml]$sampleReader.ReadToEnd() } finally { $sampleReader.Dispose() }
} finally { $sampleArchive.Dispose() }
$sampleNs = [System.Xml.XmlNamespaceManager]::new($sampleXml.NameTable)
$sampleNs.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
$sampleParagraphs = @($sampleXml.SelectNodes('//w:p',$sampleNs) | ForEach-Object { ($_.SelectNodes('.//w:t',$sampleNs) | ForEach-Object { $_.InnerText }) -join '' })
$sampleDirectory = Join-Path $sampleRoot '.local'
New-Item -ItemType Directory -Force -Path $sampleDirectory | Out-Null
[System.IO.File]::WriteAllText((Join-Path $sampleDirectory 'sample-voc.txt'), ($sampleParagraphs -join "`n"), [System.Text.UTF8Encoding]::new($false))
