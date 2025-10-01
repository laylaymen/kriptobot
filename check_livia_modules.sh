#!/bin/bash

# LIVIA 1-54 modül kontrolü script'i
echo "=== LIVIA Modül Varlık Kontrolü (1-54) ==="
echo

# Mevcut dosyaları listele
existing_files=$(ls -1 /workspaces/kriptobot/modules/livia/*.js | xargs -n1 basename | sort)

# Her LIVIA-XX için beklenen dosya adları (lıvıa.txt'den çıkarılan)
declare -A expected_modules=(
    ["01"]="operatorDialogOrchestrator.js"
    ["02"]="guardQuestionEngine.js"
    ["03"]="biasAwarenessMonitor.js"
    ["04"]="confirmationBounds.js"
    ["05"]="actionApprovalGateway.js"
    ["06"]="operatorUIBridge.js"
    ["07"]="knowledgeRouter.js"
    ["08"]="policyExplainer.js"
    ["09"]="decisionRationaleWriter.js"
    ["10"]="sessionMemory.js"
    ["11"]="operatorNoteTaker.js"
    ["12"]="promptTemplateRegistry.js"
    ["13"]="i18nSwitch.js"
    ["14"]="telemetryDailyDigest.js"
    ["15"]="incidentPostmortemWriter.js"
    ["16"]="empathyDrivenCooldownPlanner.js"
    ["17"]="reactiveDefenseGate.js"
    ["18"]="behavioralAnchorReset.js"
    ["19"]="emotionalRecoveryMonitor.js"
    ["20"]="operatorFatigueSentinel.js"
    ["21"]="piiGuardAndRedactor.js"
    ["22"]="opsDigestDistributor.js"
    ["23"]="policyUpdateOrchestrator.js"
    ["24"]="knowledgeRouterBridge.js"
    ["25"]="riskScenarioSimulator.js"
    ["26"]="ethicsAndComplianceGate.js"
    ["27"]="secretsLeakScanner.js"
    ["28"]="runbookAutoPilot.js"
    ["29"]="chaosTelemetryFuzzer.js"
    ["30"]="contextAwareMoralLimiter.js"
    ["31"]="runMetricsHousekeeper.js"
    ["32"]="realtimeUptimeSLOGuard.js"
    ["33"]="incidentDrillScheduler.js"
    ["34"]="realtimeCostGuard.js"
    ["35"]="featureFlagOrchestrator.js"
    ["36"]="experimentAnalyzer.js"
    ["37"]="guardrailBanditAllocator.js"
    ["38"]="provenanceChainLogger.js"
    ["39"]="dataLineageIndexer.js"
    ["40"]="privacyRiskScorer.js"
    ["41"]="dataQualitySentinel.js"
    ["42"]="schemaChangeAutoMitigator.js"
    ["43"]="modelDriftWatcher.js"
    ["44"]="autoRetrainOrchestrator.js"
    ["45"]="canaryAutoPromoter.js"
    ["46"]="featureStoreSync.js"
    ["47"]="kbIndexAutotuner.js"
    ["48"]="complianceAuditExporter.js"
    ["49"]="multiRegionFailoverCoordinator.js"
    ["50"]="disasterRecoveryDrills.js"
    ["51"]="releaseFreezeController.js"
    ["52"]="chaosExperimentDesigner.js"
    ["53"]="costAnomalyGuard.js"
    ["54"]="trafficShaper.js"
)

total_count=0
present_count=0
missing_count=0

missing_modules=()
present_modules=()

echo "Kontrol ediliyor..."
echo

for i in $(seq -w 01 54); do
    total_count=$((total_count + 1))
    expected_file="${expected_modules[$i]}"
    
    if [[ -z "$expected_file" ]]; then
        echo "❓ LIVIA-$i: Tanımsız modül"
        missing_count=$((missing_count + 1))
        missing_modules+=("LIVIA-$i: Tanımsız")
        continue
    fi
    
    if echo "$existing_files" | grep -q "^$expected_file$"; then
        echo "✅ LIVIA-$i: $expected_file (MEVCUT)"
        present_count=$((present_count + 1))
        present_modules+=("LIVIA-$i: $expected_file")
    else
        echo "❌ LIVIA-$i: $expected_file (EKSİK)"
        missing_count=$((missing_count + 1))
        missing_modules+=("LIVIA-$i: $expected_file")
    fi
done

echo
echo "=== ÖZET ==="
echo "Toplam modül: $total_count"
echo "Mevcut: $present_count"
echo "Eksik: $missing_count"
echo "Başarı oranı: $(echo "scale=1; $present_count * 100 / $total_count" | bc)%"

if [ $missing_count -gt 0 ]; then
    echo
    echo "=== EKSİK MODÜLLER ==="
    for module in "${missing_modules[@]}"; do
        echo "$module"
    done
fi

echo
echo "=== DOSYA SAYISI KONTROLÜ ==="
echo "Klasördeki toplam .js dosya sayısı: $(echo "$existing_files" | wc -l)"
echo "liviaOrchestrator.js hariç: $(($(echo "$existing_files" | wc -l) - 1))"