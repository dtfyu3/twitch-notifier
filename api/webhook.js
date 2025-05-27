const { createHmac } = require('crypto');
const axios = require('axios');

const config = {
  twitch: {
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    webhookSecret: process.env.TWITCH_WEBHOOK_SECRET,
    streamerId: process.env.TWITCH_STREAMER_ID,
    targetGame: process.env.GAME_NAME, 
    keywords: process.env.KEYWORDS.toLowerCase().split(',') || []
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  },
  google: {
    scriptUrl: process.env.GOOGLE_SCRIPT_URL
  }
};

async function logRawRequest(headers, body) {
  const timestamp = headers['twitch-eventsub-message-timestamp'];
  const messageId = headers['twitch-eventsub-message-id'];
  const hmac = createHmac('sha256', config.twitch.webhookSecret);
  hmac.update(messageId + timestamp + JSON.stringify(body));
  const calculatedSignature = `sha256=${hmac.digest('hex')}`;
  const isValidSign = calculatedSignature === headers['twitch-eventsub-message-signature'];
  const { shouldNotify, title, vodUrl, streamerName } = await checkStreamConditions();
  console.log(shouldNotify,title,game,vodUrl)
  let url;
  if (shouldNotify && isValidSign) url = vodUrl
  else url = null;
  const rowData = {
    timestamp: new Date().toISOString(),
    raw_body: body,
    ip: headers['x-forwarded-for'] || 'unknown',
    validSign: isValidSign,
    url: url
  };

  await axios.post(config.google.scriptUrl, {
    token: process.env.GOOGLE_SECRET,
    data: rowData,
  }, {
  headers: {'Content-Type': 'application/json'}
});
}
// Проверка подписи Twitch
function verifySignature(body, signature, headers) {
  const timestamp = headers['twitch-eventsub-message-timestamp'];
  const messageId = headers['twitch-eventsub-message-id'];
  const hmac = createHmac('sha256', config.twitch.webhookSecret);
  hmac.update(messageId + timestamp + JSON.stringify(body));
  return `sha256=${hmac.digest('hex')}` === signature;
}

// Отправка в Telegram
async function sendTelegramAlert(title, vodUrl, streamerName) {
  const message = `_${streamerName}_ только что завершил стрим  
_${title}_.  
[Смотреть](${vodUrl})`;
  await axios.post(
    `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
    { chat_id: config.telegram.chatId, text: message, parse_mode: "Markdown" }
  );
}

// Получение access_token для Twitch API
async function getTwitchAccessToken() {
  const { data } = await axios.post(
    `https://id.twitch.tv/oauth2/token?client_id=${config.twitch.clientId}&client_secret=${config.twitch.clientSecret}&grant_type=client_credentials`
  );
  return data.access_token;
}

// Проверка игры и названия стрима
async function checkStreamConditions() {
  const token = await getTwitchAccessToken();
  const { data } = await axios.get(
    `https://api.twitch.tv/helix/videos?user_id=${config.twitch.streamerId}&first=1`,
    { headers: { 'Client-ID': config.twitch.clientId, 'Authorization': `Bearer ${token}` } }
  );

  if (data.data?.length > 0) {
    const vod = data.data[0];
    const isGameMatch = vod.game_name === config.twitch.targetGame;
    const isTitleMatch = config.twitch.keywords.some(keyword => vod.title.toLowerCase().includes(keyword));
    
    if (isTitleMatch) {
      return { 
        shouldNotify: true, 
        title: vod.title, 
        streamerName: vod.user_name,
        vodUrl: `https://twitch.tv/videos/${vod.id}` 
      };
    }
  }
  return { shouldNotify: false };
}

// Обработчик вебхука
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  
  try {
    const body = req.body;
    //console.log(JSON.stringify(req.headers));
    await logRawRequest(req.headers, body);
    const signature = req.headers['twitch-eventsub-message-signature'];

    if(!body)  return res.status(200).json({ error: "No body provided" });
    if (body.challenge) {
      console.log("Получен challenge, отвечаем...");
      return res.status(200).send(body.challenge);
    }
    
    // Проверка подписи
    if (!verifySignature(body, signature, req.headers)) {
      return res.status(403).json({ error: "Invalid signature" });
    }

    // Проверка события "стрим окончен"
    if (body.subscription?.type === "stream.offline") {
      const { shouldNotify, title, vodUrl,streamerName } = await checkStreamConditions();
      if (shouldNotify) {
        await sendTelegramAlert(title, vodUrl, streamerName);
      }
    }

    res.status(200).json({ status: "OK" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};
