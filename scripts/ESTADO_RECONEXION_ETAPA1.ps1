# Consulta pasiva. No detiene ni reinicia ningun PLC.
param([string]$URL = 'http://127.0.0.1:3000/api/supervisor')
$ErrorActionPreference = 'Stop'
$r = Invoke-RestMethod -Uri $URL -Method Get -TimeoutSec 8
$plc = @($r.plc)
Write-Host "Supervisor: $($r.estado) | Total: $($plc.Count)" -ForegroundColor Cyan
$plc | Group-Object comunicacion | Select-Object Count, Name | Format-Table -AutoSize
$plc | Select-Object id, ip, tipoSupervision, comunicacion,
  identidadCoincide, estadoVerificacionMAC, estadoRedPC,
  fallosConsecutivos, numeroRecuperaciones, error | Format-Table -Wrap -AutoSize
$escritorio = [Environment]::GetFolderPath('Desktop')
$destino = Join-Path $escritorio ('ESTADO_ETAPA1_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.csv')
$plc | Export-Csv -Path $destino -NoTypeInformation -Encoding UTF8
Write-Host "CSV: $destino" -ForegroundColor Green
