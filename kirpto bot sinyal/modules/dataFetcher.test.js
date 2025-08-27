const { fetchMultiTimeframe } = require('./dataFetcher');

describe('fetchMultiTimeframe', () => {
  it('should return an object with 15m, 4h, and 1d keys', async () => {
    const symbol = 'BTCUSDT';
    const data = await fetchMultiTimeframe(symbol);
    expect(data).toHaveProperty('15m');
    expect(data).toHaveProperty('4h');
    expect(data).toHaveProperty('1d');
    expect(data['15m']).toHaveProperty('open');
    expect(data['15m']).toHaveProperty('close');
    expect(data['15m']).toHaveProperty('high');
    expect(data['15m']).toHaveProperty('low');
    expect(data['15m']).toHaveProperty('volume');
  });
}); 