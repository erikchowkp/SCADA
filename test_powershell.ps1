# PowerShell Extension Test Script
# This tests basic PowerShell functionality

Write-Host "Testing PowerShell Extension..."

# Test variables
$testVariable = "PowerShell is working!"
$currentDate = Get-Date

# Test output
Write-Output "Current Date: $currentDate"
Write-Output $testVariable

# Test function
function Test-Extension {
    param(
        [string]$Message
    )
    return "Extension test: $Message"
}

# Call the function
$result = Test-Extension -Message "Success!"
Write-Output $result

# Test cmdlet completion
Get-Process | Select-Object -First 3 Name, Id, CPU
