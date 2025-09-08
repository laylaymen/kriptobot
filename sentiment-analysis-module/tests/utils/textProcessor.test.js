describe('Text Processor Utility Functions', () => {
    const { normalizeText, tokenizeText, cleanText } = require('../../src/utils/textProcessor');

    test('normalizeText should convert text to lowercase and trim whitespace', () => {
        const input = '  Hello World!  ';
        const expected = 'hello world!';
        expect(normalizeText(input)).toBe(expected);
    });

    test('tokenizeText should split text into words', () => {
        const input = 'Hello world, this is a test.';
        const expected = ['hello', 'world', 'this', 'is', 'a', 'test'];
        expect(tokenizeText(input)).toEqual(expected);
    });

    test('cleanText should remove punctuation and extra spaces', () => {
        const input = 'Hello, world! This is a test.   ';
        const expected = 'hello world this is a test';
        expect(cleanText(input)).toBe(expected);
    });
});