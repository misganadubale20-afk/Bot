const TelegramBot = require('node-telegram-bot-api');

// --- 1. CONFIGURATION ---
const TOKEN = "8529929285:AAHwfWLGT7WKSyuZn_Zybs0PWx6a-FjLddI"; 
const DB_URL = "https://data-myfa.vercel.app/api/db/bot";
const DB_KEY = "QLE3KvEiqW29j269";
const ADMIN_PASSWORD = "123"; // Password for Admin Panel

const bot = new TelegramBot(TOKEN, { polling: false });

// --- 2. DATABASE HELPER ---
async function callDB(endpoint, method = "GET", data = null) {
    const options = {
        method,
        headers: { "Content-Type": "application/json", "x-secret-key": DB_KEY }
    };
    if (data) options.body = JSON.stringify(data);
    try {
        const res = await fetch(`${DB_URL}${endpoint}`, options);
        if (res.status === 404) return null;
        return await res.json();
    } catch (e) { return null; }
}

// --- 3. SERVERLESS HANDLER ---
export default async function handler(req, res) {
    const body = req.body;

    // A. Handle Admin API (From admin.html)
    if (req.method === 'POST' && body.action) {
        if(body.password !== ADMIN_PASSWORD) return res.status(401).json({error: "Wrong Password"});

        if(body.action === 'get_settings') {
            let settings = await callDB('/config/settings') || getDefaultSettings();
            return res.status(200).json(settings);
        }

        if(body.action === 'save_settings') {
            await callDB('/config/settings', 'POST', body.data);
            return res.status(200).json({success: true});
        }

        if(body.action === 'broadcast') {
            // Get all user IDs (We store them in a separate list)
            const list = await callDB('/config/user_list') || { ids: [] };
            let count = 0;
            for(const id of list.ids) {
                try {
                    await bot.sendMessage(id, body.message, {parse_mode: 'HTML'});
                    count++;
                } catch(e) {}
            }
            return res.status(200).json({sent: count});
        }
    }

    // B. Handle User Withdrawals (From index.html)
    if(req.method === 'POST' && body.action === 'withdraw') {
        const settings = await callDB('/config/settings') || getDefaultSettings();
        const msg = `<b>💰 Withdrawal Request</b>\n\n👤 ${body.name}\n🆔 <code>${body.userId}</code>\n💵 $${body.amount}\n💳 ${body.method}\n🔢 ${body.account}`;
        // Send to Admin Channel or ID defined in settings
        await bot.sendMessage(settings.adminId || body.userId, msg, {parse_mode: 'HTML'});
        return res.status(200).send('OK');
    }

    // C. Handle Telegram Updates
    if (req.method === 'POST' && body.message) {
        await handleMessage(body.message);
    }

    res.status(200).send('OK');
}

// --- 4. TELEGRAM LOGIC ---
async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text || "";
    const userId = msg.from.id.toString();
    const name = msg.from.first_name;

    // Load Settings
    let settings = await callDB('/config/settings');
    if(!settings) {
        settings = getDefaultSettings();
        await callDB('/config/settings', 'POST', settings);
    }

    if (text.startsWith('/start')) {
        // 1. Save User ID for Broadcasts
        let list = await callDB('/config/user_list');
        if(!list) list = { ids: [] };
        if(!list.ids.includes(chatId)) {
            list.ids.push(chatId);
            await callDB('/config/user_list', 'POST', list);
        }

        // 2. Create User Profile if new
        let user = await callDB(`/users/${userId}`);
        if(!user) {
            // Referral Logic
            const refId = text.split(' ')[1];
            if(refId && refId !== userId) {
                let refUser = await callDB(`/users/${refId}`);
                if(refUser) {
                    refUser.balance = (refUser.balance || 0) + (settings.referralBonus || 0.01);
                    refUser.referrals = (refUser.referrals || 0) + 1;
                    await callDB(`/users/${refId}`, 'POST', refUser);
                    bot.sendMessage(refId, `🎉 New Referral: ${name}`).catch(()=>{});
                }
            }
            
            user = { id: userId, balance: 0, ads: 0, refs: 0 };
            await callDB(`/users/${userId}`, 'POST', user);
        }

        // 3. Send Welcome
        const opts = {
            caption: settings.welcomeText.replace('{name}', name),
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📱 Open App", web_app: { url: settings.appUrl } }],
                    [{ text: "📢 Join Channel", url: settings.channelUrl }]
                ]
            }
        };
        
        // If image exists send photo, else message
        if(settings.imageUrl.startsWith('http')) {
            await bot.sendPhoto(chatId, settings.imageUrl, opts);
        } else {
            await bot.sendMessage(chatId, opts.caption, opts);
        }
    }
}

function getDefaultSettings() {
    return {
        welcomeText: "Hello {name}, welcome to Taka Income Pro!",
        imageUrl: "https://i.ibb.co/93229pT/file-32.jpg",
        channelUrl: "https://t.me/BasicTouchPro",
        appUrl: "https://your-vercel-app.vercel.app", // UPDATE THIS AFTER DEPLOY
        adminId: "YOUR_ID", // For withdrawal logs
        adZoneId: "12345",
        adReward: 0.001,
        minWithdraw: 0.10,
        referralBonus: 0.01
    };
}