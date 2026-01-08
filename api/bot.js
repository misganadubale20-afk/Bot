const TelegramBot = require('node-telegram-bot-api');

// --- CONFIG ---
const TOKEN = "8529929285:AAHwfWLGT7WKSyuZn_Zybs0PWx6a-FjLddI"; 
const ADMIN_ID = "6464599036";
const WEBAPP_URL = "https://botxx.vercel.app"; 
const DB_URL = "https://data-myfa.vercel.app/api/db/bot";
const DB_KEY = "QLE3KvEiqW29j269";
const ADMIN_PASSWORD = "123"; 

const bot = new TelegramBot(TOKEN, { polling: false });

// Helper: DB
async function callDB(endpoint, method = "GET", data = null) {
    const options = { method, headers: { "Content-Type": "application/json", "x-secret-key": DB_KEY } };
    if (data) options.body = JSON.stringify(data);
    try {
        const res = await fetch(`${DB_URL}${endpoint}`, options);
        if (res.status === 404) return null;
        return await res.json();
    } catch (e) { return null; }
}

export default async function handler(req, res) {
    const body = req.body;

    // --- 1. ADMIN ACTIONS ---
    if (req.method === 'POST' && body.action === 'admin_action') {
        if(body.password !== ADMIN_PASSWORD) return res.status(401).json({error: "Wrong Password"});

        // Get Dashboard Stats
        if(body.type === 'get_stats') {
            const userList = await callDB('/config/user_list') || { ids: [] };
            const wList = await callDB('/withdrawals/pending') || { list: [] };
            const paidStats = await callDB('/config/paid_stats') || { total: 0 };
            
            return res.json({
                totalUsers: userList.ids.length,
                pendingWithdrawals: wList.list.length,
                totalPaid: paidStats.total
            });
        }

        // Get Withdrawals
        if(body.type === 'get_withdrawals') {
            const wList = await callDB('/withdrawals/pending') || { list: [] };
            return res.json({ withdrawals: wList.list });
        }

        // Approve Withdrawal
        if(body.type === 'approve_withdraw') {
            // Remove from pending
            let wList = await callDB('/withdrawals/pending') || { list: [] };
            wList.list = wList.list.filter(w => w.userId !== body.userId); // Remove by ID (simplification)
            await callDB('/withdrawals/pending', 'POST', wList);

            // Add to total paid
            let paid = await callDB('/config/paid_stats') || { total: 0 };
            paid.total += parseFloat(body.amount);
            await callDB('/config/paid_stats', 'POST', paid);

            // Notify User
            try { await bot.sendMessage(body.userId, `✅ Withdrawal Approved: $${body.amount}`); } catch(e){}
            return res.json({success: true});
        }

        // Save Settings
        if(body.type === 'save_settings') {
            await callDB('/config/settings', 'POST', body.data);
            return res.json({success: true});
        }
        
        // Get Settings
        if(body.type === 'get_settings') {
            let s = await callDB('/config/settings');
            return res.json(s || getDefaultSettings());
        }

        // Broadcast
        if(body.type === 'broadcast') {
            const list = await callDB('/config/user_list') || { ids: [] };
            let count = 0;
            for(const id of list.ids) {
                try {
                    if(body.image) await bot.sendPhoto(id, body.image, {caption: body.message, parse_mode:'HTML'});
                    else await bot.sendMessage(id, body.message, {parse_mode:'HTML'});
                    count++;
                } catch(e){}
            }
            return res.json({sent: count});
        }
    }

    // --- 2. USER WITHDRAWAL REQUEST ---
    if (req.method === 'POST' && body.action === 'withdraw') {
        const wReq = {
            userId: body.userId,
            name: body.name,
            amount: body.amount,
            method: body.method,
            account: body.account,
            date: new Date().toISOString()
        };

        // 1. Send Alert to Admin Telegram
        const msg = `<b>💰 New Withdrawal</b>\n\n👤 ${body.name}\n🆔 <code>${body.userId}</code>\n💵 $${body.amount}\n💳 ${body.method}\n🔢 ${body.account}`;
        await bot.sendMessage(ADMIN_ID, msg, {parse_mode: 'HTML'});

        // 2. Save to DB for Admin Panel
        let wList = await callDB('/withdrawals/pending');
        if(!wList) wList = { list: [] };
        wList.list.push(wReq);
        await callDB('/withdrawals/pending', 'POST', wList);

        return res.status(200).send('OK');
    }

    // --- 3. TELEGRAM BOT ---
    if (req.method === 'POST' && body.message) {
        await handleTelegramMessage(body.message);
    }

    res.status(200).send('OK');
}

// Logic same as before...
async function handleTelegramMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text || "";
    const userId = msg.from.id.toString();
    const name = msg.from.first_name;

    let settings = await callDB('/config/settings');
    if(!settings) settings = getDefaultSettings();

    if (text.startsWith('/start')) {
        // Save User ID for Stats/Broadcast
        let list = await callDB('/config/user_list');
        if(!list) list = { ids: [] };
        if(!list.ids.includes(chatId)) {
            list.ids.push(chatId);
            await callDB('/config/user_list', 'POST', list);
        }

        // Existing create user / referral logic...
        let user = await callDB(`/users/${userId}`);
        if (!user) {
            const refId = text.split(' ')[1];
            if (refId && refId !== userId) {
                let refUser = await callDB(`/users/${refId}`);
                if (refUser) {
                    refUser.balance = (refUser.balance || 0) + (parseFloat(settings.refBonus) || 0.01);
                    refUser.referrals = (refUser.referrals || 0) + 1;
                    await callDB(`/users/${refId}`, 'POST', refUser);
                    bot.sendMessage(refId, `🎉 Referral Bonus!`).catch(()=>{});
                }
            }
            await callDB(`/users/${userId}`, 'POST', { id: userId, firstName: name, balance: 0, referrals: 0, adCount: 0 });
        }

        const opts = {
            caption: settings.welcomeText.replace('{name}', name),
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Open App", web_app: { url: settings.appUrl || WEBAPP_URL } }],
                    [{ text: "📢 Join Channel", url: settings.botLink || "https://t.me/BasicTouchPro" }]
                ]
            }
        };

        if(settings.welcomeImg && settings.welcomeImg.startsWith('http')) {
            try { await bot.sendPhoto(chatId, settings.welcomeImg, opts); } 
            catch(e) { await bot.sendMessage(chatId, opts.caption, opts); }
        } else {
            await bot.sendMessage(chatId, opts.caption, opts);
        }
    }
}

function getDefaultSettings() {
    return {
        welcomeText: "Hi {name}! Welcome.",
        welcomeImg: "https://img.freepik.com/free-vector/hand-holding-phone-with-coins_23-2148094669.jpg",
        appUrl: WEBAPP_URL,
        botLink: "https://t.me/Beshbesh_Bot",
        adReward: 0.001,
        refBonus: 0.01,
        minWithdraw: 0.10
    };
}