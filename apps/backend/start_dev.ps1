param(
    [string]$BindHost = "127.0.0.1",
    [int]$Port = 8000,
    [switch]$NoReload
)

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Error "Python virtual environment not found at $python"
    exit 1
}

$args = @(
    "-m", "uvicorn",
    "main:app",
    "--host", $BindHost,
    "--port", $Port
)

if (-not $NoReload) {
    $args += "--reload"

    foreach ($path in @(".venv", "uploads", "vectorstores", "chroma_db", "__pycache__")) {
        $args += @("--reload-exclude", $path)
    }
}

& $python @args
