const { createFakeContact, getBotName } = require('../lib/fakeContact');

const morningMessages = [
    "Rise and shine! A brand new day awaits you!",
    "Make today amazing!",
    "Wake up with determination, go to bed with satisfaction!",
    "Every morning brings new potential. Don't waste it!",
    "The sun is up and so are your possibilities!",
    "Today is a gift. That's why it's called the present!",
    "Let your smile change the world today!",
    "A new day, a new blessing, a new hope."
];

const afternoonMessages = [
    "Hope your day is going great so far!",
    "Keep up the good work this afternoon!",
    "The afternoon sun reminds us we still have time to make today count!",
    "Stay positive and productive this afternoon!",
    "You're halfway through - keep going!"
];

const eveningMessages = [
    "Time to relax and enjoy the evening!",
    "You've earned some rest after a long day!",
    "The evening is the perfect time to reflect on the day's blessings.",
    "Winding down? You did great today!",
    "Let the calm of the night refresh your soul."
];

function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

async function goodmorningCommand(sock, chatId, message) {
    const fakeContact = createFakeContact(message);
    const pushName = message.pushName || 'Friend';
    try {
        const msg = randomPick(morningMessages);
        await sock.sendMessage(chatId, { text: `Good Morning ${pushName}!\n\n${msg}` }, { quoted: fakeContact });
    } catch (error) {
        console.error('Error in goodmorning command:', error);
        await sock.sendMessage(chatId, { text: `Good Morning ${pushName}! Wishing you a beautiful day ahead!` }, { quoted: fakeContact });
    }
}

async function goodafternoonCommand(sock, chatId, message) {
    const fakeContact = createFakeContact(message);
    const pushName = message.pushName || 'Friend';
    try {
        const msg = randomPick(afternoonMessages);
        await sock.sendMessage(chatId, { text: `Good Afternoon ${pushName}!\n\n${msg}` }, { quoted: fakeContact });
    } catch (error) {
        console.error('Error in goodafternoon command:', error);
        await sock.sendMessage(chatId, { text: `Good Afternoon ${pushName}! Hope your day is going great!` }, { quoted: fakeContact });
    }
}

async function goodeveningCommand(sock, chatId, message) {
    const fakeContact = createFakeContact(message);
    const pushName = message.pushName || 'Friend';
    try {
        const msg = randomPick(eveningMessages);
        await sock.sendMessage(chatId, { text: `Good Evening ${pushName}!\n\n${msg}` }, { quoted: fakeContact });
    } catch (error) {
        console.error('Error in goodevening command:', error);
        await sock.sendMessage(chatId, { text: `Good Evening ${pushName}! Time to relax and enjoy the evening!` }, { quoted: fakeContact });
    }
}

module.exports = { goodmorningCommand, goodafternoonCommand, goodeveningCommand };
