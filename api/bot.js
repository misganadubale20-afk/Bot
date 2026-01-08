const TelegramBot = require('node-telegram-bot-api');

// =======================================================
// 👇 YOUR CONFIGURATION (Hardcoded as requested) 👇
// =======================================================
const TOKEN = "8529929285:AAHwfWLGT7WKSyuZn_Zybs0PWx6a-FjLddI"; 
const ADMIN_ID = "6464599036"; 
const WEBAPP_URL = "https://botxx.vercel.app"; 

// Database Config
const DB_URL = "https://data-myfa.vercel.app/api/db/bot";
const DB_KEY = "QLE3KvEiqW29j269";

// Password to access https://botxx.vercel.app/admin.html
const ADMIN_PASSWORD = "123"; 
// =======================================================

const bot = new TelegramBot(TOKEN, { polling: false });

// --- HELPER: Database Connection ---
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
    } catch (e) { 
        console.error("DB Error:", e);
        return null; 
    }
}

// --- SERVERLESS HANDLER ---
export default async function handler(req, res) {
    try {
        const body = req.body;

        // 1. Handle Admin Panel Actions (from admin.html)
        if (req.method === 'POST' && body.action === 'admin_action') {
            if(body.password !== ADMIN_PASSWORD) return res.status(401).json({error: "Wrong Password"});
            
            if(body.type === 'get_settings') {
                let s = await callDB('/config/settings');
                return res.json(s || getDefaultSettings());
            }
            if(body.type === 'save_settings') {
                await callDB('/config/settings', 'POST', body.data);
                return res.json({success: true});
            }
            if(body.type === 'broadcast') {
                const list = await callDB('/config/user_list') || { ids: [] };
                let count = 0;
                for(const id of list.ids) {
                    try { await bot.sendMessage(id, body.message, {parse_mode: 'HTML'}); count++; } catch(e){}
                }
                return res.json({sent: count});
            }
        }

        // 2. Handle Withdrawal Requests (from index.html)
        if (req.method === 'POST' && body.action === 'withdraw') {
            const msg = `<b>💰 New Withdrawal Request</b>\n\n👤 ${body.name}\n🆔 <code>${body.userId}</code>\n💵 $${body.amount}\n💳 ${body.method}\n🔢 ${body.account}`;
            
            // Send alert to YOUR Admin ID
            await bot.sendMessage(ADMIN_ID, msg, {parse_mode: 'HTML'});
            return res.status(200).send('OK');
        }

        // 3. Handle Telegram Bot Logic (Webhooks)
        if (req.method === 'POST' && body.message) {
            await handleTelegramMessage(body.message);
        }

    } catch(e) {
        console.error("Handler Error:", e);
    }
    
    // Always return 200 to Telegram
    res.status(200).send('OK');
}

// --- TELEGRAM MESSAGE LOGIC ---
async function handleTelegramMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text || "";
    const userId = msg.from.id.toString();
    const name = msg.from.first_name || "User";

    // 1. Load Settings from DB (or use defaults)
    let settings = await callDB('/config/settings');
    if (!settings) {
        settings = getDefaultSettings();
        // Save defaults to DB so Admin panel works immediately
        await callDB('/config/settings', 'POST', settings); 
    }

    if (text.startsWith('/start')) {
        // A. Save User ID for Broadcasts
        let list = await callDB('/config/user_list');
        if(!list) list = { ids: [] };
        if(!list.ids.includes(chatId)) {
            list.ids.push(chatId);
            await callDB('/config/user_list', 'POST', list);
        }

        // B. Check/Create User Profile
        let user = await callDB(`/users/${userId}`);
        if (!user) {
            // Referral Logic
            const refId = text.split(' ')[1];
            if (refId && refId !== userId) {
                let refUser = await callDB(`/users/${refId}`);
                if (refUser) {
                    const bonus = parseFloat(settings.referralBonus) || 0.01;
                    refUser.balance = (refUser.balance || 0) + bonus;
                    refUser.referrals = (refUser.referrals || 0) + 1;
                    
                    // Save Referrer
                    await callDB(`/users/${refId}`, 'POST', refUser);
                    
                    // Notify Referrer
                    try { 
                        await bot.sendMessage(refId, `🎉 *Referral Bonus!*\n\n${name} joined.\n+$${bonus} added!`, {parse_mode:'Markdown'}); 
                    } catch(e){}
                }
            }

            // Create New User
            await callDB(`/users/${userId}`, 'POST', {
                id: userId,
                firstName: name,
                balance: 0.00,
                adCount: 0,
                referrals: 0,
                bonusTasks: [],
                history: [],
                joinedAt: new Date().toISOString()
            });
        }

        // C. Send Welcome Message
        const opts = {
            caption: settings.welcomeText.replace('{name}', name),
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Open App", web_app: { url: settings.appUrl } }], // Uses settings.appUrl
                    [{ text: "📢 Join Channel", url: settings.channelUrl }]
                ]
            }
        };

        // Send Photo if URL exists, otherwise Message
        if(settings.imageUrl && settings.imageUrl.startsWith('http')) {
            try {
                await bot.sendPhoto(chatId, settings.imageUrl, opts);
            } catch(e) {
                // Fallback if image fails
                await bot.sendMessage(chatId, opts.caption, opts);
            }
        } else {
            await bot.sendMessage(chatId, opts.caption, opts);
        }
    }
}

// Default settings if DB is empty
function getDefaultSettings() {
    return {
        welcomeText: "Hi {name}! \n\n👇 Click below to start earning:",
        imageUrl: "https://cdn-icons-png.flaticon.com/512/2504/2504936.png", // Safe default image
        appUrl: WEBAPP_URL, // Uses your Vercel URL
        channelUrl: "https://t.me/BasicTouchPro",
        adZoneId: "YOUR_MONETAG_ZONE_ID",
        adReward: 0.001,
        minWithdraw: 0.10,
        referralBonus: 0.01
    };
}