// newsReactionRouter.js
// Haber ve duygu analizini sistemlere yönlendiren router modülü

/**
 * routeNewsImpact
 * @param {Object} newsImpact - newsFetcher.js çıktısı (impact, triggeredModules, etc.)
 * @param {Object} sentiment - newsSentimentAnalyzer.js çıktısı (sentimentScore, sentimentTag, actionSuggested)
 * @returns {Array} route - sistem, modül, aksiyon listesi
 */
function routeNewsImpact(newsImpact, sentiment) {
  const route = [];
  // Her tetiklenen modül ve sistem için aksiyon belirle
  if (Array.isArray(newsImpact.triggeredModules)) {
    for (const mod of newsImpact.triggeredModules) {
      let system = '';
      if (mod.includes('reflexivePatternTracker') || mod.includes('adaptiveScenarioBuilder')) system = 'Grafik Beyni';
      else if (mod.includes('emotionalDefenseLauncher') || mod.includes('contextSuppressionTrigger') || mod.includes('emergencyHoldActivator')) system = 'LIVIA';
      else if (mod.includes('macroDisruptionLog') || mod.includes('strategyIntegrityEvaluator')) system = 'Denetim Asistanı';
      else system = 'Genel';
      let action = 'activate';
      if (sentiment.sentimentTag === 'negative' && system === 'LIVIA') action = 'suppress';
      if (sentiment.sentimentTag === 'positive' && system === 'Grafik Beyni') action = 'boost';
      if (sentiment.sentimentTag === 'neutral') action = 'log';
      route.push({ system, module: mod, action });
    }
  }
  // Sentiment önerileri de ekle
  if (sentiment && sentiment.actionSuggested) {
    for (const [sys, act] of Object.entries(sentiment.actionSuggested)) {
      route.push({ system: sys, module: 'sentiment', action: act });
    }
  }
  return route;
}

module.exports = { routeNewsImpact };
