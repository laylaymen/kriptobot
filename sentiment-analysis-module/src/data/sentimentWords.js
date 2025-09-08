const sentimentWords = {
    positive: {
        strong: ['bull', 'surge', 'rally', 'moon', 'adoption', 'breakthrough', 'profit', 'success', 'gain', 'approval'],
        moderate: ['good', 'positive', 'green', 'up', 'rise', 'win', 'bullish']
    },
    negative: {
        strong: ['collapse', 'crash', 'ban', 'scam', 'hack', 'hacked', 'rug', 'exploit', 'stolen'],
        moderate: ['down', 'fall', 'drop', 'loss', 'bear', 'red', 'decline', 'worry', 'concern', 'risk']
    },
    neutral: ['stable', 'unchanged', 'flat', 'sideways', 'consolidation', 'waiting', 'analysis']
};

module.exports = sentimentWords;