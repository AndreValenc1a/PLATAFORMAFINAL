param(
    [int]$DuracionSegundos = 180,
    [int]$IntervaloSegundos = 5,
    [string]$Url = "http://127.0.0.1:3000/api/supervisor"
)

# Ejecutar desde el MISMO PC del servidor antes de desconectar el cable.
# No escribe en PLC ni reinicia la supervision: solo consulta la API local.
$ErrorActionPreference = "Stop"
$marca = Get-Date -Format "yyyyMMdd_HHmmss"
$csv = Join-Path $PSScriptRoot "diagnostico_reconexion_$marca.csv"
$inicio = Get-Date
$contador = 0

Write-Host "=== DIAGNOSTICO DE RECUPERACION PLC ===" -ForegroundColor Cyan
Write-Host "Salida: $csv"
Write-Host "Realice la prueba de red solamente cuando sea seguro para el laboratorio."

while (((Get-Date) - $inicio).TotalSeconds -lt $DuracionSegundos) {
    $contador++
    try {
        $respuesta = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 4
        $instante = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        $registros = foreach ($plc in @($respuesta.plc)) {
            [pscustomobject]@{
                fecha = $instante
                muestra = $contador
                id = $plc.id
                modelo = $plc.modelo
                tipoSupervision = $plc.tipoSupervision
                ip = $plc.ip
                comunicacion = $plc.comunicacion
                identidadCoincide = $plc.identidadCoincide
                macDetectada = $plc.macDetectada
                calidad = $plc.calidad
                intentosConexion = $plc.intentosConexion
                error = $plc.error
            }
        }
        if ($registros) {
            $registros | Export-Csv -LiteralPath $csv -NoTypeInformation -Append -Encoding UTF8
            $agrupados = $registros | Group-Object comunicacion | ForEach-Object { "$($_.Name)=$($_.Count)" }
            Write-Host "$instante TOTAL=$($registros.Count) $($agrupados -join ' ')"
        }
    } catch {
        Write-Warning "No se pudo leer la API local: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $IntervaloSegundos
}

if (Test-Path -LiteralPath $csv) {
    $todo = Import-Csv -LiteralPath $csv
    $ultima = ($todo | Measure-Object -Property muestra -Maximum).Maximum
    Write-Host "`n=== RESUMEN DE LA ULTIMA MUESTRA ===" -ForegroundColor Cyan
    $todo | Where-Object { [int]$_.muestra -eq [int]$ultima } |
        Group-Object tipoSupervision, comunicacion |
        Sort-Object Count -Descending |
        Select-Object Count, Name | Format-Table -AutoSize
    Write-Host "Archivo para compartir: $csv" -ForegroundColor Green
} else {
    Write-Warning "No se genero CSV. Compruebe que el backend este ejecutandose."
}
