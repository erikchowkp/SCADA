# Git Helper Script
# This script provides Git functionality by finding and using the Git installation

function Find-Git {
    # Common Git installation paths
    $paths = @(
        "C:\Program Files\Git\cmd\git.exe",
        "C:\Program Files\Git\bin\git.exe",
        "C:\Program Files (x86)\Git\cmd\git.exe",
        "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
    )
    
    foreach ($path in $paths) {
        if (Test-Path $path) {
            return $path
        }
    }
    
    # Try to find via PATH
    try {
        $gitCmd = Get-Command git -ErrorAction Stop
        return $gitCmd.Source
    } catch {
        throw "Git not found. Please ensure Git is installed."
    }
}

function Invoke-Git {
    param(
        [Parameter(ValueFromRemainingArguments=$true)]
        [string[]]$Arguments
    )
    
    $gitPath = Find-Git
    & $gitPath @Arguments
}

# Export the function
Export-ModuleMember -Function Invoke-Git
