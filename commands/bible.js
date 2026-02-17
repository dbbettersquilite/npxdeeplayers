const fetch = require('node-fetch');
const { createFakeContact, getBotName } = require('../lib/fakeContact');
async function bibleCommand(sock, chatId, message, text, prefix) {
    try {
        const fake = createFakeContact(message);
        const BASE_URL = "https://bible-api.com";

        if (!text || text.trim() === '') {
            await sock.sendMessage(chatId, {
                text: `📖 *Bible Command*\n\n` +
                      `Usage: *${prefix}bible <chapter:verse>*\n\n` +
                      `Examples:\n` +
                      `• ${prefix}bible John 3:16\n` +
                      `• ${prefix}bible Genesis 1:1\n` +
                      `• ${prefix}bible Psalm 23\n\n` +
                      `Use *${prefix}biblelist* to see all books`
            }, { quoted: fake });
            return;
        }

        const chapterInput = encodeURIComponent(text.trim());
        const chapterRes = await fetch(`${BASE_URL}/${chapterInput}`);

        if (!chapterRes.ok) {
            await sock.sendMessage(chatId, {
                text: `❌ Invalid chapter/verse format!\n\n` +
                      `Please use format: *Book Chapter:Verse*\n` +
                      `Example: *${prefix}bible John 3:16*`
            }, { quoted: fake });
            return;
        }

        const chapterData = await chapterRes.json();
        const bibleText = `
*📖 The Holy Bible*

*📚 Reference:* ${chapterData.reference}
*📖 Translation:* ${chapterData.translation_name}
*📊 Verses:* ${chapterData.verses.length}

*📜 Content:*
${chapterData.text}
        `.trim();

        await sock.sendMessage(chatId, { text: bibleText }, { quoted: fake });

    } catch (error) {
        console.error('Bible command error:', error);
        const fake = createFakeContact(message);
        await sock.sendMessage(chatId, {
            text: `❌ Error: ${error.message}\n\n` +
                  `Please use format: *${prefix}bible <Book Chapter:Verse>*\n` +
                  `Example: *${prefix}bible John 3:16*`
        }, { quoted: fake });
    }
}

async function bibleListCommand(sock, chatId, message) {
    try {
        const fake = createFakeContact(message);
        
        const bibleList = `
*📖 BIBLE BOOKS LIST*

📜 *OLD TESTAMENT:*
1. Genesis
2. Exodus
3. Leviticus
4. Numbers
5. Deuteronomy
6. Joshua
7. Judges
8. Ruth
9. 1 Samuel
10. 2 Samuel
11. 1 Kings
12. 2 Kings
13. 1 Chronicles
14. 2 Chronicles
15. Ezra
16. Nehemiah
17. Esther
18. Job
19. Psalms
20. Proverbs
21. Ecclesiastes
22. Song of Solomon
23. Isaiah
24. Jeremiah
25. Lamentations
26. Ezekiel
27. Daniel
28. Hosea
29. Joel
30. Amos
31. Obadiah
32. Jonah
33. Micah
34. Nahum
35. Habakkuk
36. Zephaniah
37. Haggai
38. Zechariah
39. Malachi

📖 *NEW TESTAMENT:*
1. Matthew
2. Mark
3. Luke
4. John
5. Acts
6. Romans
7. 1 Corinthians
8. 2 Corinthians
9. Galatians
10. Ephesians
11. Philippians
12. Colossians
13. 1 Thessalonians
14. 2 Thessalonians
15. 1 Timothy
16. 2 Timothy
17. Titus
18. Philemon
19. Hebrews
20. James
21. 1 Peter
22. 2 Peter
23. 1 John
24. 2 John
25. 3 John
26. Jude
27. Revelation

*📚 Usage:*
.bible <Book> <Chapter>:<Verse>
Example: .bible John 3:16
        `.trim();

        await sock.sendMessage(chatId, { text: bibleList }, { quoted: fake });

    } catch (error) {
        console.error('Bible list command error:', error);
        const fake = createFakeContact(message);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to fetch Bible list. Please try again later.'
        }, { quoted: fake });
    }
}

async function quranCommand(sock, chatId, message, text) {
    try {
        const fake = createFakeContact(message);
        
        if (!text || isNaN(parseInt(text.trim()))) {
            await sock.sendMessage(chatId, {
                text: `📖 *Quran Command*\n\n` +
                      `Usage: .quran <surah_number>\n` +
                      `Example: .quran 1\n\n` +
                      `Surah numbers range from 1 to 114`
            }, { quoted: fake });
            return;
        }

        const surahNumber = parseInt(text.trim());
        
        if (surahNumber < 1 || surahNumber > 114) {
            await sock.sendMessage(chatId, {
                text: '❌ Invalid surah number! Please use a number between 1 and 114.'
            }, { quoted: fake });
            return;
        }

        const url = `https://apis.davidcyriltech.my.id/quran?surah=${surahNumber}`;
        const res = await fetch(url);
        const data = await res.json();

        if (!data.success) {
            await sock.sendMessage(chatId, {
                text: '❌ Could not fetch Surah. Please try another number.'
            }, { quoted: fake });
            return;
        }

        const { number, name, type, ayahCount, tafsir, recitation } = data.surah;

        let replyText = `📖 *Surah ${name.english}* (${name.arabic})\n\n`;
        replyText += `*Number:* ${number}\n`;
        replyText += `*Type:* ${type}\n`;
        replyText += `*Ayahs:* ${ayahCount}\n\n`;
        replyText += `*Tafsir:* ${tafsir.id}`;

        // Send text first
        await sock.sendMessage(chatId, { text: replyText }, { quoted: fake });

        // Then send audio if available
        if (recitation) {
            try {
                const audioRes = await fetch(recitation);
                const audioBuffer = await audioRes.buffer();
                
                await sock.sendMessage(chatId, {
                    audio: audioBuffer,
                    mimetype: "audio/mpeg",
                    ptt: false
                }, { quoted: fake });
            } catch (audioError) {
                console.error('Audio download error:', audioError);
                await sock.sendMessage(chatId, {
                    text: '📢 Audio recitation unavailable at the moment.'
                }, { quoted: fake });
            }
        }

    } catch (error) {
        console.error('Quran command error:', error);
        const fake = createFakeContact(message);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to fetch Quran data. Please try again later.'
        }, { quoted: fake });
    }
}

module.exports = {
    bibleCommand,
    bibleListCommand,
    quranCommand
};