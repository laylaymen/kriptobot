const { encrypt } = require('./envSecure');

// Buraya anahtarınızı (64 karakterlik hex) ve şifrelemek istediğiniz değeri girin
const key = 'e89f4cf92cbb3860870878529186520737d75c4c0bf4619c226eade04a606604';
const value = 'd07eb5a0e02c45a78d5b18269ba029f3';

const encrypted = encrypt(value, key);
console.log('Şifreli değer:', encrypted); 