class WordChainGame {
    constructor(hostId) {
        this.host = hostId;
        this.players = [hostId];
        this.scores = {};
        this.scores[hostId] = 0;
        this.usedWords = new Set();
        this.currentPlayerIndex = 0;
        this.lastWord = null;
        this.state = 'WAITING';
        this.rounds = 0;
        this.maxInactivity = 60000;
        this.createdAt = Date.now();
    }

    addPlayer(playerId) {
        if (this.players.includes(playerId)) return false;
        if (this.state !== 'WAITING') return false;
        this.players.push(playerId);
        this.scores[playerId] = 0;
        return true;
    }

    start() {
        if (this.players.length < 2) return false;
        this.state = 'PLAYING';
        this.currentPlayerIndex = 0;
        return true;
    }

    get currentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    submitWord(playerId, word) {
        if (this.state !== 'PLAYING') return { ok: false, reason: 'Game not active' };
        if (playerId !== this.currentPlayer) return { ok: false, reason: 'Not your turn' };

        word = word.toLowerCase().trim();

        if (word.length < 2) return { ok: false, reason: 'Word must be at least 2 letters' };
        if (this.usedWords.has(word)) return { ok: false, reason: 'Word already used!' };
        if (this.lastWord) {
            const lastChar = this.lastWord.charAt(this.lastWord.length - 1);
            if (word.charAt(0) !== lastChar) {
                return { ok: false, reason: `Word must start with "${lastChar.toUpperCase()}"` };
            }
        }

        this.usedWords.add(word);
        this.lastWord = word;
        this.scores[playerId] = (this.scores[playerId] || 0) + word.length;
        this.rounds++;
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;

        return { ok: true, nextPlayer: this.currentPlayer, word };
    }

    eliminateCurrentPlayer() {
        const eliminated = this.players.splice(this.currentPlayerIndex, 1)[0];
        if (this.currentPlayerIndex >= this.players.length) {
            this.currentPlayerIndex = 0;
        }
        if (this.players.length <= 1) {
            this.state = 'ENDED';
        }
        return eliminated;
    }

    getScoreboard() {
        return Object.entries(this.scores)
            .sort((a, b) => b[1] - a[1])
            .map(([player, score], i) => `${i + 1}. @${player.split(':')[0].split('@')[0]}: ${score} pts`)
            .join('\n');
    }

    get winner() {
        if (this.players.length === 1) return this.players[0];
        return null;
    }

    static findAIWord(lastChar, usedWords) {
        const commonWords = {
            'a': ['apple', 'arrow', 'angel', 'animal', 'anchor', 'album', 'atom', 'acid', 'azure'],
            'b': ['banana', 'bridge', 'bottle', 'butter', 'brain', 'beach', 'blood', 'brave'],
            'c': ['cat', 'castle', 'crown', 'chain', 'cloud', 'coral', 'cream', 'click'],
            'd': ['dog', 'dream', 'dance', 'door', 'drum', 'dusk', 'drift', 'delta'],
            'e': ['eagle', 'earth', 'energy', 'extra', 'echo', 'ember', 'eleven', 'event'],
            'f': ['fish', 'flame', 'forest', 'friend', 'frost', 'flash', 'fruit', 'field'],
            'g': ['grape', 'garden', 'ghost', 'green', 'glass', 'globe', 'grain', 'gear'],
            'h': ['house', 'heart', 'honey', 'horse', 'hello', 'hunter', 'hammer', 'haze'],
            'i': ['island', 'iron', 'ivory', 'igloo', 'image', 'input', 'index', 'ice'],
            'j': ['jungle', 'jewel', 'juice', 'jacket', 'jazz', 'jolly', 'junior', 'jest'],
            'k': ['king', 'knife', 'knight', 'kite', 'kernel', 'karma', 'knot', 'keen'],
            'l': ['lion', 'light', 'lemon', 'lake', 'lunar', 'lotus', 'letter', 'lime'],
            'm': ['moon', 'magic', 'music', 'mouse', 'maple', 'mirror', 'metal', 'mint'],
            'n': ['night', 'nature', 'noble', 'north', 'nest', 'needle', 'nerve', 'note'],
            'o': ['ocean', 'orange', 'orbit', 'olive', 'onion', 'opera', 'opal', 'oven'],
            'p': ['planet', 'pearl', 'piano', 'python', 'price', 'plant', 'power', 'pulse'],
            'q': ['queen', 'quest', 'quiet', 'quilt', 'quartz', 'quick', 'quote', 'quiz'],
            'r': ['river', 'rainbow', 'rocket', 'rose', 'rain', 'robot', 'ridge', 'rust'],
            's': ['star', 'stone', 'snake', 'storm', 'sugar', 'silver', 'sand', 'sword'],
            't': ['tiger', 'tower', 'train', 'tree', 'table', 'torch', 'tulip', 'trail'],
            'u': ['umbrella', 'unicorn', 'ultra', 'unity', 'urban', 'upper', 'usual', 'under'],
            'v': ['violet', 'voice', 'valley', 'venom', 'verse', 'vault', 'vivid', 'vine'],
            'w': ['water', 'world', 'winter', 'whale', 'wind', 'wizard', 'wolf', 'wave'],
            'x': ['xenon', 'xerox', 'xylophone'],
            'y': ['yellow', 'yacht', 'yarn', 'youth', 'yield', 'yonder'],
            'z': ['zebra', 'zero', 'zone', 'zenith', 'zodiac', 'zephyr', 'zinc'],
        };

        const words = commonWords[lastChar] || [];
        const available = words.filter(w => !usedWords.has(w));
        if (available.length > 0) {
            return available[Math.floor(Math.random() * available.length)];
        }
        return null;
    }
}

module.exports = WordChainGame;
