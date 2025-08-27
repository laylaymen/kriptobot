require('dotenv').config();
const { decrypt } = require('./envSecure');
const readline = require('readline');
const { fetchAndClassifyNews, getLatestNewsImpact } = require('./newsFetcher');

async function decryptEnvKey() {
  if (process.env.NEWS_API_KEY && process.env.NEWS_API_KEY.startsWith('enc:')) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ask = (q) => new Promise((res) => rl.question(q, res));
    const key = await ask('Şifre çözme anahtarını girin (hex): ');
    rl.close();
    process.env.NEWS_API_KEY = decrypt(process.env.NEWS_API_KEY.slice(4), key);
    console.log('Testte çözülen NEWS_API_KEY:', process.env.NEWS_API_KEY);
  }
}

(async () => {
  await decryptEnvKey();
  const results = await fetchAndClassifyNews();
  console.log('Sınıflandırılmış haberler:', JSON.stringify(results, null, 2));

  if (!Array.isArray(results)) {
    console.error('HATA: Sonuç bir dizi değil!');
    process.exit(1);
  }
  if (results.length === 0) {
    console.warn('UYARI: Hiç haber bulunamadı veya API anahtarı eksik!');
    process.exit(0);
  }
  const first = results[0];
  if (typeof first.impactCategory === 'undefined') {
    console.error('HATA: impactCategory alanı yok!');
    process.exit(1);
  }
  if (!first.title) {
    console.error('HATA: title alanı yok!');
    process.exit(1);
  }
  if (!first.timestamp) {
    console.error('HATA: timestamp alanı yok!');
    process.exit(1);
  }
  console.log('Haberler başarıyla çekildi ve sınıflandırıldı!');
  process.exit(0);
})(); 