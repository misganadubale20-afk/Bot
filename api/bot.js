// api/bot.js
const TelegramBot = require('node-telegram-bot-api');

// ----------------------------------------------------
// 👇 HARDCODE CONFIGURATION 👇
// ----------------------------------------------------
const TOKEN = "YOUR_BOT_TOKEN_HERE"; 
const ADMIN_ID = "YOUR_TELEGRAM_USER_ID"; // For withdrawal alerts
const WEBAPP_URL = "https://your-project.vercel.app"; 

// YOUR CUSTOM DATABASE CONFIG
const DB_URL = "https://data-myfa.vercel.app/api/db/bot";
const DB_KEY = "QLE3KvEiqW29j269";
// ----------------------------------------------------

const bot = new TelegramBot(TOKEN, { polling: false });

// Helper: Call Custom DB
async function callDB(endpoint, method = "GET", data = null) {
    const options = {
        method,
        headers: {
            "Content-Type": "application/json",
            "x-secret-key": DB_KEY
        }
    };
    if (data) options.body = JSON.stringify(data);
    
    try {
        const res = await fetch(`${DB_URL}${endpoint}`, options);
        // If 404, return null (user not found)
        if (res.status === 404) return null;
        return await res.json();
    } catch (e) {
        console.error("DB Error:", e);
        return null;
    }
}

export default async function handler(req, res) {
    try {
        const body = req.body;

        // 1. Handle Telegram Messages
        if (req.method === 'POST' && body.message) {
            await handleTelegramMessage(body.message);
        }
        
        // 2. Handle Withdrawal Notification (Sent from Frontend)
        else if (req.method === 'POST' && body.action === 'withdraw') {
            const { userDetails, userId, amount, method, account } = body;
            const msg = `<b>💰 Withdrawal Request</b>\n\n👤 ${userDetails}\n🆔 <code>${userId}</code>\n💳 ${method}\n🔢 <code>${account}</code>\n💵 $${amount}`;
            await bot.sendMessage(ADMIN_ID, msg, { parse_mode: 'HTML' });
        }

    } catch (error) {
        console.error('Error:', error);
    }
    res.status(200).send('OK');
}

async function handleTelegramMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text || "";
    const userId = msg.from.id.toString();
    const firstName = msg.from.first_name || "User";
    const username = msg.from.username ? `@${msg.from.username}` : "none";

    // Welcome Image
    const userPhoto = "https://i.ibb.co/93229pT/file-32.jpg"; 

    if (text.startsWith('/start')) {
        
        // 1. Check if user exists in Custom DB
        let userData = await callDB(`/users/${userId}`);

        // 2. If User doesn't exist, create them
        if (!userData || !userData.id) {
            
            // Check Referral Logic
            const params = text.split(' ');
            let referrerId = null;
            if (params.length > 1 && params[1] !== userId) {
                referrerId = params[1];
            }

            // Create new user object
            userData = {
                id: userId,
                firstName: firstName,
                username: username,
                balance: 0.00,
                adsWatched: 0,
                referrals: 0,
                referredBy: referrerId || "none",
                joinedAt: new Date().toISOString()
            };

            // Save new user to DB
            await callDB(`/users/${userId}`, "POST", userData);

            // 3. Process Referral Reward
            if (referrerId) {
                const refUser = await callDB(`/users/${referrerId}`);
                if (refUser && refUser.id) {
                    // Update Referrer Balance (+ $0.01)
                    refUser.balance = (refUser.balance || 0) + 0.01;
                    refUser.referrals = (refUser.referrals || 0) + 1;
                    
                    // Save Referrer
                    await callDB(`/users/${referrerId}`, "POST", refUser);

                    // Notify Referrer
                    try {
                        await bot.sendMessage(referrerId, `🎉 *New Referral!*\n\n${firstName} joined.\n+$0.01 Added!`, { parse_mode: 'Markdown' });
                    } catch (e) {}
                }
            }
        }

        // 4. Send Welcome UI
        const opts = {
            caption: `Hi! Welcome *${firstName}*\n\nYour Balance: $${(userData.balance || 0).toFixed(3)}\n\n👇 Click below to earn:`,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Open App", web_app: { url: WEBAPP_URL } }],
                    [{ text: "📢 Join Channel", url: "https://t.me/BasicTouchPro" }] 
                ]
            }
        };
        await bot.sendPhoto(chatId, userPhoto, opts);
    }
}