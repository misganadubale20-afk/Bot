const TelegramBot = require('node-telegram-bot-api');

// =======================================================
// 👇 YOUR CONFIGURATION 👇
// =======================================================
const TOKEN = "8529929285:AAHwfWLGT7WKSyuZn_Zybs0PWx6a-FjLddI"; 
const ADMIN_ID = "6464599036"; // Your ID for withdrawal alerts
const WEBAPP_URL = "https://botxx.vercel.app"; 

// Custom Database Config
const DB_URL = "https://data-myfa.vercel.app/api/db/bot";
const DB_KEY = "QLE3KvEiqW29j269";

// Password for admin.html
const ADMIN_PASSWORD = "123"; 
// =======================================================

// Initialize Bot (Polling False for Vercel)
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

// --- MAIN SERVERLESS HANDLER ---
export default async function handler(req, res) {
    try {
        const body = req.body;

        // ------------------------------------------------
        // 1. ADMIN PANEL ACTIONS (from admin.html)
        // ------------------------------------------------
        if (req.method === 'POST' && body.action === 'admin_action') {
            
            // Security Check
            if(body.password !== ADMIN_PASSWORD) {
                return res.status(401).json({error: "Wrong Password"});
            }

            // A. Get Settings
            if(body.type === 'get_settings') {
                let s = await callDB('/config/settings');
                return res.json(s || getDefaultSettings());
            }

            // B. Save Settings
            if(body.type === 'save_settings') {
                await callDB('/config/settings', 'POST', body.data);
                return res.json({success: true});
            }

            // C. Broadcast Message
            if(body.type === 'broadcast') {
                const list = await callDB('/config/user_list') || { ids: [] };
                
                // Construct Button (if provided)
                const opts = { parse_mode: 'HTML' };
                if(body.btnText && body.btnLink) {
                    opts.reply_markup = {
                        inline_keyboard: [[{ text: body.btnText, url: body.btnLink }]]
                    };
                }

                let count = 0;
                // Loop through all users
                for(const id of list.ids) {
                    try {
                        if(body.image) {
                            await bot.sendPhoto(id, body.image, { caption: body.message, ...opts });
                        } else {
                            await bot.sendMessage(id, body.message, opts);
                        }
                        count++;
                    } catch(e) {
                        // User blocked bot, ignore
                    }
                }
                return res.json({sent: count});
            }
        }

        // ------------------------------------------------
        // 2. WITHDRAWAL REQUESTS (from index.html)
        // ------------------------------------------------
        if (req.method === 'POST' && body.action === 'withdraw') {
            const msg = `
<b>💰 New Withdrawal Request</b>

👤 <b>User:</b> ${body.name}
🆔 <b>ID:</b> <code>${body.userId}</code>
--------------------------------
💵 <b>Amount:</b> $${body.amount}
💳 <b>Method:</b> ${body.method}
🔢 <b>Account:</b> <code>${body.account}</code>
            `;
            
            // Send alert to YOUR Admin Telegram ID
            await bot.sendMessage(ADMIN_ID, msg, {parse_mode: 'HTML'});
            return res.status(200).send('OK');
        }

        // ------------------------------------------------
        // 3. TELEGRAM BOT LOGIC (Webhooks)
        // ------------------------------------------------
        if (req.method === 'POST' && body.message) {
            await handleTelegramMessage(body.message);
        }

    } catch(e) {
        console.error("Handler Error:", e);
    }
    
    // Always return 200 OK to Telegram
    res.status(200).send('OK');
}

// --- TELEGRAM MESSAGE LOGIC ---
async function handleTelegramMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text || "";
    const userId = msg.from.id.toString();
    const name = msg.from.first_name || "User";

    // 1. Load Settings (or defaults)
    let settings = await callDB('/config/settings');
    if (!settings) settings = getDefaultSettings();

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
            // --- Referral Logic ---
            const refId = text.split(' ')[1]; // Extract ID after /start
            
            if (refId && refId !== userId) {
                let refUser = await callDB(`/users/${refId}`);
                if (refUser) {
                    const bonus = parseFloat(settings.refBonus) || 0.01; // Use setting or default
                    
                    // Update Referrer
                    refUser.balance = (refUser.balance || 0) + bonus;
                    refUser.referrals = (refUser.referrals || 0) + 1;
                    
                    await callDB(`/users/${refId}`, 'POST', refUser);
                    
                    // Notify Referrer
                    try { 
                        await bot.sendMessage(refId, `🎉 *New Referral!*\n\n${name} joined using your link.\n+$${bonus} added!`, {parse_mode:'Markdown'}); 
                    } catch(e){}
                }
            }

            // --- Create New User ---
            await callDB(`/users/${userId}`, 'POST', {
                id: userId,
                firstName: name,
                balance: 0.00,
                adCount: 0,
                referrals: 0,
                bonusTasks: [],
                joinedAt: new Date().toISOString()
            });
        }

        // C. Send Welcome Message
        const welcomeText = settings.welcomeText.replace('{name}', name);
        const btnText = settings.btnText || "🚀 Open App";
        
        const opts = {
            caption: welcomeText,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: btnText, web_app: { url: settings.appUrl } }],
                    [{ text: "📢 Join Channel", url: settings.botLink }] // Using botLink field for channel or support
                ]
            }
        };

        // Send Photo if available
        if(settings.welcomeImg && settings.welcomeImg.startsWith('http')) {
            try {
                await bot.sendPhoto(chatId, settings.welcomeImg, opts);
            } catch(e) {
                // Fallback to text if image error
                await bot.sendMessage(chatId, welcomeText, opts);
            }
        } else {
            await bot.sendMessage(chatId, welcomeText, opts);
        }
    }
}

// Defaults
function getDefaultSettings() {
    return {
        welcomeText: "Hi {name}! Welcome to Besh Besh.",
        welcomeImg: "https://img.freepik.com/free-vector/hand-holding-phone-with-coins_23-2148094669.jpg",
        appUrl: WEBAPP_URL,
        botLink: "https://t.me/Beshbesh_Bot",
        adReward: 5,
        refBonus: 25,
        minWithdraw: 10,
        currency: "Br",
        btnText: "🚀 Open App"
    };
}