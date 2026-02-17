const DiceGame = require('../lib/dicegame');
const { createFakeContact, getBotName } = require('../lib/fakeContact');

const games = {};
const gameTimeouts = {};

function getPlayerName(jid) {
    return (jid || '').split(':')[0].split('@')[0];
}

function clearDiceTimeout(chatId) {
    if (gameTimeouts[chatId]) {
        clearTimeout(gameTimeouts[chatId]);
        delete gameTimeouts[chatId];
    }
}

async function diceCommand(sock, chatId, senderId, fullArgs) {
    try {
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (games[chatId] && games[chatId].state !== 'ENDED') {
            const g = games[chatId];
            const players = g.players.map(p => `@${getPlayerName(p)}`).join(', ');
            await sock.sendMessage(chatId, {
                text: `*${botName} DICE GAME*\n\nA game is already active!\nPlayers: ${players}\nRound: ${g.round}/${g.maxRounds}\n\nUse .roll to roll dice\nUse .diceend to end the game`,
                mentions: g.players
            }, { quoted: fake });
            return;
        }

        const rounds = parseInt(fullArgs) || 3;
        const maxRounds = Math.min(Math.max(rounds, 1), 10);

        games[chatId] = new DiceGame(senderId, maxRounds);

        clearDiceTimeout(chatId);
        gameTimeouts[chatId] = setTimeout(() => {
            if (games[chatId] && games[chatId].state === 'WAITING') {
                delete games[chatId];
                sock.sendMessage(chatId, {
                    text: `*${botName}*\nDice game expired. No one joined in time.`
                }).catch(() => {});
            }
        }, 120000);

        await sock.sendMessage(chatId, {
            text: `*${botName} DICE GAME*\n\n@${getPlayerName(senderId)} started a dice game!\n\n*Rounds:* ${maxRounds}\n*How to play:* Roll two dice each round. Highest total score wins!\n\n*Join:* .dicejoin\n*Start:* .dicebegin (when all players joined)\n*Roll:* .roll (during your turn)`,
            mentions: [senderId]
        }, { quoted: fake });
    } catch (err) {
        console.error('Dice command error:', err);
    }
}

async function diceAICommand(sock, chatId, senderId, fullArgs) {
    try {
        const fake = createFakeContact(senderId);
        const botName = getBotName();

        if (games[chatId] && games[chatId].state !== 'ENDED') {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nA game is already active! End it first with .diceend`
            }, { quoted: fake });
            return;
        }

        const rounds = parseInt(fullArgs) || 3;
        const maxRounds = Math.min(Math.max(rounds, 1), 10);
        const botJid = 'bot@s.whatsapp.net';

        const game = new DiceGame(senderId, maxRounds);
        game.addPlayer(botJid);
        game.start();
        games[chatId] = game;

        await sock.sendMessage(chatId, {
            text: `*${botName} DICE vs AI*\n\n@${getPlayerName(senderId)} vs Bot\n*Rounds:* ${maxRounds}\n\nYour turn! Type .roll to roll the dice.`,
            mentions: [senderId]
        }, { quoted: fake });
    } catch (err) {
        console.error('Dice AI error:', err);
    }
}

async function handleDiceJoin(sock, chatId, senderId) {
    try {
        const fake = createFakeContact(senderId);
        const botName = getBotName();
        const game = games[chatId];

        if (!game || game.state !== 'WAITING') {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nNo dice game waiting for players. Start one with .dice`
            }, { quoted: fake });
            return;
        }

        if (!game.addPlayer(senderId)) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nYou're already in the game!`
            }, { quoted: fake });
            return;
        }

        const players = game.players.map(p => `@${getPlayerName(p)}`).join(', ');
        await sock.sendMessage(chatId, {
            text: `*${botName} DICE GAME*\n\n@${getPlayerName(senderId)} joined!\nPlayers (${game.players.length}): ${players}\n\nType .dicebegin to start the game.`,
            mentions: game.players
        }, { quoted: fake });
    } catch (err) {
        console.error('Dice join error:', err);
    }
}

async function handleDiceBegin(sock, chatId, senderId) {
    try {
        const fake = createFakeContact(senderId);
        const botName = getBotName();
        const game = games[chatId];

        if (!game || game.state !== 'WAITING') {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nNo dice game to start.`
            }, { quoted: fake });
            return;
        }

        if (senderId !== game.host) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nOnly the host can start the game.`
            }, { quoted: fake });
            return;
        }

        if (!game.start()) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nNeed at least 2 players to start!`
            }, { quoted: fake });
            return;
        }

        clearDiceTimeout(chatId);

        const players = game.players.map(p => `@${getPlayerName(p)}`).join(', ');
        await sock.sendMessage(chatId, {
            text: `*${botName} DICE GAME STARTED*\n\nPlayers: ${players}\nRounds: ${game.maxRounds}\n\n@${getPlayerName(game.currentPlayer)}, it's your turn! Type .roll`,
            mentions: game.players
        }, { quoted: fake });
    } catch (err) {
        console.error('Dice begin error:', err);
    }
}

async function handleDiceRoll(sock, chatId, senderId) {
    try {
        const fake = createFakeContact(senderId);
        const botName = getBotName();
        const game = games[chatId];
        const botJid = 'bot@s.whatsapp.net';

        if (!game || game.state !== 'PLAYING') {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nNo active dice game. Start one with .dice`
            }, { quoted: fake });
            return;
        }

        const result = game.roll(senderId);
        if (!result.ok) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\n${result.reason}`
            }, { quoted: fake });
            return;
        }

        let msg = `*${botName} DICE ROLL*\n\n` +
                  `@${getPlayerName(senderId)} rolled:\n` +
                  `[ ${result.dice1} ] + [ ${result.dice2} ] = *${result.total}*\n`;

        if (result.gameOver) {
            const winner = game.winner;
            msg += `\n*GAME OVER!*\n\n*Scoreboard:*\n${game.getScoreboard()}\n\n` +
                   `Winner: @${getPlayerName(winner)}!`;
            delete games[chatId];
            clearDiceTimeout(chatId);
            await sock.sendMessage(chatId, {
                text: msg,
                mentions: game.players
            }, { quoted: fake });
        } else if (result.roundComplete) {
            msg += `\n*Round ${result.round} complete!*\n\n*Scores so far:*\n${game.getScoreboard()}\n\n` +
                   `Round ${game.round}/${game.maxRounds} - @${getPlayerName(result.nextPlayer)}, your turn! .roll`;

            if (result.nextPlayer === botJid) {
                await sock.sendMessage(chatId, { text: msg, mentions: game.players }, { quoted: fake });
                await new Promise(r => setTimeout(r, 1500));
                await handleBotDiceRoll(sock, chatId, game, botJid);
            } else {
                await sock.sendMessage(chatId, { text: msg, mentions: game.players }, { quoted: fake });
            }
        } else {
            if (result.nextPlayer === botJid) {
                msg += `\nBot's turn...`;
                await sock.sendMessage(chatId, { text: msg, mentions: [senderId] }, { quoted: fake });
                await new Promise(r => setTimeout(r, 1500));
                await handleBotDiceRoll(sock, chatId, game, botJid);
            } else {
                msg += `\n@${getPlayerName(result.nextPlayer)}, your turn! .roll`;
                await sock.sendMessage(chatId, { text: msg, mentions: [senderId, result.nextPlayer] }, { quoted: fake });
            }
        }
    } catch (err) {
        console.error('Dice roll error:', err);
    }
}

async function handleBotDiceRoll(sock, chatId, game, botJid) {
    const botName = getBotName();
    const result = game.roll(botJid);
    if (!result.ok) return;

    let msg = `*${botName} BOT ROLL*\n\n` +
              `Bot rolled:\n[ ${result.dice1} ] + [ ${result.dice2} ] = *${result.total}*\n`;

    if (result.gameOver) {
        const winner = game.winner;
        msg += `\n*GAME OVER!*\n\n*Scoreboard:*\n${game.getScoreboard()}\n\n` +
               `Winner: ${winner === botJid ? 'Bot' : `@${getPlayerName(winner)}`}!`;
        delete games[chatId];
        clearDiceTimeout(chatId);
        await sock.sendMessage(chatId, { text: msg, mentions: game.players });
    } else if (result.roundComplete) {
        msg += `\n*Round ${result.round} complete!*\n\n*Scores:*\n${game.getScoreboard()}\n\n` +
               `Round ${game.round}/${game.maxRounds} - @${getPlayerName(result.nextPlayer)}, your turn! .roll`;
        await sock.sendMessage(chatId, { text: msg, mentions: game.players });
    } else {
        msg += `\n@${getPlayerName(result.nextPlayer)}, your turn! .roll`;
        await sock.sendMessage(chatId, { text: msg, mentions: [result.nextPlayer] });
    }
}

async function diceEndCommand(sock, chatId, senderId) {
    try {
        const fake = createFakeContact(senderId);
        const botName = getBotName();
        const game = games[chatId];

        if (!game) {
            await sock.sendMessage(chatId, {
                text: `*${botName}*\nNo active dice game.`
            }, { quoted: fake });
            return;
        }

        let msg = `*${botName}*\nDice game ended by @${getPlayerName(senderId)}.`;
        if (game.state === 'PLAYING') {
            msg += `\n\n*Final Scores:*\n${game.getScoreboard()}`;
        }

        delete games[chatId];
        clearDiceTimeout(chatId);

        await sock.sendMessage(chatId, {
            text: msg,
            mentions: game.players
        }, { quoted: fake });
    } catch (err) {
        console.error('Dice end error:', err);
    }
}

function hasDiceGame(chatId) {
    return !!games[chatId] && games[chatId].state !== 'ENDED';
}

module.exports = {
    diceCommand,
    diceAICommand,
    handleDiceJoin,
    handleDiceBegin,
    handleDiceRoll,
    diceEndCommand,
    hasDiceGame,
};
