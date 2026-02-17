
const OWNER_NUMBERS = [
  "+254104260236",
];

const EMOJI = "❤️";

function normalizeJidToDigits(jid) {
  if (!jid) return "";
  const local = jid.split("@")[0];
  return local.replace(/\D/g, "");
}

function isOwnerNumber(num) {
  return OWNER_NUMBERS.some(owner =>
    num === owner ||
    num.endsWith(owner) ||
    num.includes(owner)
  );
}

async function handleDevReact(sock, msg) {
  try {
    if (!msg?.key || !msg.message) return;

    const remoteJid = msg.key.remoteJid || "";

    // in groups
    if (!remoteJid.endsWith("@g.us")) return;

    const isGroup = remoteJid.endsWith("@g.us");

    const rawSender = isGroup ? msg.key.participant : msg.key.remoteJid;
    const digits = normalizeJidToDigits(rawSender);

    if (!isOwnerNumber(digits)) return;
    await sock.sendMessage(remoteJid, {
      react: { text: "", key: msg.key }
    });

    // Know react buoy
    await sock.sendMessage(remoteJid, {
      react: { text: EMOJI, key: msg.key }
    });

  } catch {}
}

module.exports = handleDevReact;