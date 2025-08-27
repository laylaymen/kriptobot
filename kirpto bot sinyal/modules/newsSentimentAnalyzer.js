// newsSentimentAnalyzer.js
// Haber başlığı ve açıklamasından duygu (sentiment) analizi yapan modül

const POSITIVE_WORDS = [
  { word: 'approval', score: 2 },
  { word: 'approved', score: 2 },
  { word: 'etf', score: 2 },
  { word: 'listing', score: 1.5 },
  { word: 'pump', score: 1.5 },
  { word: 'bull', score: 1 },
  { word: 'gain', score: 1 },
  { word: 'surge', score: 1 },
  { word: 'positive', score: 1 }
];
const NEGATIVE_WORDS = [
  { word: 'hack', score: -2 },
  { word: 'hacked', score: -2 },
  { word: 'collapse', score: -2 },
  { word: 'ban', score: -1.5 },
  { word: 'down', score: -1 },
  { word: 'exploit', score: -1.5 },
  { word: 'panic', score: -1.5 },
  { word: 'illegal', score: -1 },
  { word: 'negative', score: -1 }
];

function analyzeSentiment(title, description) {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  let score = 0;
  let reasons = [];

  for (const { word, score: s } of POSITIVE_WORDS) {
    if (text.includes(word)) {
      score += s;
      reasons.push(word);
    }
  }
  for (const { word, score: s } of NEGATIVE_WORDS) {
    if (text.includes(word)) {
      score += s;
      reasons.push(word);
    }
  }

  // Normalize score to -1..1
  let sentimentScore = Math.max(-1, Math.min(1, score / 4));
  let sentimentTag = 'neutral';
  if (sentimentScore > 0.25) sentimentTag = 'positive';
  else if (sentimentScore < -0.25) sentimentTag = 'negative';

  // Sistem önerileri
  let actionSuggested = {};
  if (sentimentTag === 'positive') {
    actionSuggested = {
      grafikBeyni: 'sinyal onay',
      livia: 'engel kaldır'
    };
  } else if (sentimentTag === 'negative') {
    actionSuggested = {
      livia: 'sinyal baskı',
      grafikBeyni: 'falseBreakFilter aktif et'
    };
  } else {
    actionSuggested = {
      denetimAsistani: 'logla'
    };
  }

  return {
    sentimentScore,
    sentimentTag,
    reason: reasons,
    actionSuggested
  };
}

module.exports = { analyzeSentiment };
