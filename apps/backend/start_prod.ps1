param(
    [string]$BindHost = "0.0.0.0",
    [int]$Port = 8000
)

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Error "Python virtual environment not found at $python"
    exit 1
}

& $python -m uvicorn main:app --host $BindHost --port $Port
