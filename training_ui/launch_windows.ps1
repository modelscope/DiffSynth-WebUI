param(
    [int]$FrontendPort = 8100,
    [int]$BackendPort = 8000,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$TrainingUiDir = (Resolve-Path (Join-Path $PSScriptRoot ".")).Path
$WebUiRoot = (Resolve-Path (Join-Path $TrainingUiDir "..")).Path
$StudioRoot = if ($env:DIFFSYNTH_STUDIO_ROOT) {
    (Resolve-Path $env:DIFFSYNTH_STUDIO_ROOT).Path
} else {
    (Resolve-Path (Join-Path $WebUiRoot "DiffSynth-Studio")).Path
}
$FrontendDir = Join-Path $TrainingUiDir "nextjs_app\frontend"
$LogDir = if ($env:DIFFSYNTH_UI_LOG_DIR) { $env:DIFFSYNTH_UI_LOG_DIR } else { Join-Path $env:TEMP "diffsynth-webui-$FrontendPort" }
$Processes = @()

function Fail([string]$Message) {
    throw "[launch_windows] $Message"
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Fail "missing command: $Name"
    }
}

function Resolve-NpmCommand {
    $command = Get-Command "npm.cmd" -CommandType Application -ErrorAction SilentlyContinue
    if (-not $command) {
        Fail "missing command: npm.cmd"
    }
    return $command.Source
}

function Wait-Http([string]$Url, [string]$Name) {
    for ($i = 0; $i -lt 40; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Write-Host "[launch_windows] $Name ready"
                return
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    Fail "$Name did not become ready: $Url"
}

function Start-LoggedProcess([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory, [string]$LogName) {
    $stdout = Join-Path $LogDir "$LogName.log"
    $stderr = Join-Path $LogDir "$LogName.error.log"
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $script:Processes += $process
    return $process
}

try {
    if ($FrontendPort -eq $BackendPort) {
        Fail "FrontendPort and BackendPort must be different"
    }
    Require-Command "python"
    Require-Command "node"
    $NpmCommand = Resolve-NpmCommand
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $LogDir = (Resolve-Path $LogDir).Path

    if (-not (Test-Path (Join-Path $StudioRoot "diffsynth")) -or -not (Test-Path (Join-Path $StudioRoot "examples"))) {
        Fail "invalid DiffSynth-Studio root: $StudioRoot; initialize the submodule or set up the repository again"
    }
    $env:DIFFSYNTH_STUDIO_ROOT = $StudioRoot
    $env:BACKEND_PORT = "$BackendPort"
    $env:NEXT_BASE_PATH = ""
    $env:NEXT_SERVER_PORT = "$FrontendPort"
    $env:NEXT_SERVER_HOST = "127.0.0.1"
    $env:NEXT_TELEMETRY_DISABLED = "1"
    $env:PYTHONPATH = "$StudioRoot;$TrainingUiDir;$env:PYTHONPATH"

    if (-not $SkipBuild) {
        Push-Location $FrontendDir
        try {
            if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
                Write-Host "[launch_windows] installing frontend dependencies..."
                & $NpmCommand install
                if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }
            }
            Write-Host "[launch_windows] building frontend..."
            & $NpmCommand run build
            if ($LASTEXITCODE -ne 0) { Fail "npm run build failed" }
        } finally {
            Pop-Location
        }
    }

    python -c "import fastapi, uvicorn, multipart" 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "Python WebUI dependencies are incomplete; run pip install -e '.[webui]'" }

    $backend = Start-LoggedProcess "python" @("-m", "uvicorn", "nextjs_app.backend.main:app", "--host", "127.0.0.1", "--port", "$BackendPort") $TrainingUiDir "backend"
    Wait-Http "http://127.0.0.1:$BackendPort/api/health" "backend"

    $frontendArgs = @("run", "start", "--", "-p", "$FrontendPort", "-H", "127.0.0.1")
    $frontend = Start-LoggedProcess $NpmCommand $frontendArgs $FrontendDir "frontend"
    Wait-Http "http://127.0.0.1:$FrontendPort/dashboard" "frontend"

    Write-Host "[launch_windows] ready"
    Write-Host "[launch_windows] open: http://127.0.0.1:$FrontendPort/dashboard"
    Write-Host "[launch_windows] press Ctrl+C to stop"
    while (-not $frontend.HasExited -and -not $backend.HasExited) {
        Start-Sleep -Seconds 1
    }
} finally {
    foreach ($process in $Processes) {
        if (-not $process.HasExited) {
            try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
}
