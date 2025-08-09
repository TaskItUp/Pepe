document.addEventListener('DOMContentLoaded', () => {
    // --- Firebase Configuration ---
    const firebaseConfig = {
        apiKey: "AIzaSyA_l71gxjNPxLZ-5oV40ap-8Cp_4MnH-Jg",
        authDomain: "taskitup-9de28.firebaseapp.com",
        projectId: "taskitup-9de28",
        storageBucket: "taskitup-9de28.appspot.com",
        messagingSenderId: "1030752202095",
        appId: "1:1030752202095:web:ac1b5a8ff85ba2c6204c9a"
    };

    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    const tg = window.Telegram.WebApp;

    tg.expand();
    tg.ready();

    let currentUser = null;
    const AD_REWARD = 250;
    const DAILY_AD_LIMIT = 40;

    if (!tg.initDataUnsafe || !tg.initDataUnsafe.user) {
        document.body.innerHTML = '<div style="text-align: center; padding: 50px; font-family: \'Poppins\', sans-serif;">Please open this app inside Telegram.</div>';
        return;
    }
    
    currentUser = tg.initDataUnsafe.user;
    initializeUser(currentUser);

    // --- MAIN USER INITIALIZATION ---
    async function initializeUser(user) {
        const userRef = db.collection('users').doc(String(user.id));
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            const referrerId = tg.initDataUnsafe.start_param || null;
            const newUser = {
                id: user.id,
                username: user.username || 'N/A',
                firstName: user.first_name,
                balance: 0,
                adsWatchedToday: 0,
                totalAdsEver: 0,
                lastAdReset: firebase.firestore.Timestamp.now(),
                completedTasks: [],
                referrals: 0,
                referralEarnings: 0,
                withdrawalTotal: 0,
                referrer: referrerId,
                createdAt: firebase.firestore.Timestamp.now()
            };
            await userRef.set(newUser);
            if (referrerId) {
                const referrerRef = db.collection('users').doc(referrerId);
                await referrerRef.update({ referrals: firebase.firestore.FieldValue.increment(1) }).catch(console.error);
            }
        }

        userRef.onSnapshot(doc => {
            if (doc.exists) {
                updateUI(doc.data());
            }
        });

        db.collection('withdrawals').where("userId", "==", user.id).orderBy("createdAt", "desc").limit(10)
            .onSnapshot(snapshot => {
                updateWithdrawalHistory(snapshot);
            });
    }
    
    // --- UI UPDATE FUNCTION ---
    function updateUI(userData) {
        const { balance, adsWatchedToday, totalAdsEver, lastAdReset, completedTasks, referrals, referralEarnings, withdrawalTotal, firstName, username, id } = userData;

        // Check for daily ad reset
        const now = new Date();
        const lastResetDate = lastAdReset.toDate();
        let currentAdsWatched = adsWatchedToday;
        if ((now - lastResetDate) / 3600000 >= 24) {
            currentAdsWatched = 0;
            db.collection('users').doc(String(id)).update({ adsWatchedToday: 0, lastAdReset: firebase.firestore.Timestamp.now() });
        }
        
        const adsLeft = DAILY_AD_LIMIT - currentAdsWatched;

        // Update balances across all tabs
        const formattedBalance = Math.floor(balance).toLocaleString();
        document.getElementById('balance-home').textContent = formattedBalance;
        document.getElementById('withdraw-balance').textContent = formattedBalance;
        document.getElementById('profile-balance').textContent = formattedBalance;

        // Home Tab
        document.getElementById('home-username').textContent = firstName;
        document.getElementById('ads-watched-today').textContent = currentAdsWatched;
        document.getElementById('ads-left-today').textContent = adsLeft;
        
        // Bonus Task Card
        const channelTaskCard = document.getElementById('task-channel-join');
        if (completedTasks.includes('channel_1')) {
            channelTaskCard.classList.add('completed');
        }

        // Earn Tab
        document.getElementById('tasks-completed').textContent = currentAdsWatched;
        const progressPercent = (currentAdsWatched / DAILY_AD_LIMIT) * 100;
        document.getElementById('task-progress-bar').style.width = `${progressPercent}%`;
        const watchAdBtn = document.getElementById('start-task-button');
        watchAdBtn.disabled = adsLeft <= 0;
        if(watchAdBtn.disabled) watchAdBtn.innerHTML = '<i class="fas fa-stop-circle"></i> Daily Limit Reached';
        else watchAdBtn.innerHTML = '<i class="fas fa-play-circle"></i> Watch Ad';
        
        // Profile Tab
        document.getElementById('profile-name').textContent = firstName;
        document.getElementById('telegram-username').textContent = `@${username}`;
        const totalEarned = balance + withdrawalTotal;
        document.getElementById('earned-so-far').textContent = Math.floor(totalEarned).toLocaleString();
        document.getElementById('total-ads-viewed').textContent = totalAdsEver;
        document.getElementById('total-refers').textContent = referrals;

        // Referral Modal & Links
        const referralLink = `https://t.me/TaskItUpBot?start=${id}`;
        document.getElementById('profile-referral-link').value = referralLink;
        document.getElementById('referral-link-modal').value = referralLink;
        document.getElementById('refer-count').textContent = referrals;
        document.getElementById('refer-earnings').textContent = Math.floor(referralEarnings).toLocaleString();
    }
    
    function updateWithdrawalHistory(snapshot) {
        const historyList = document.getElementById('history-list');
        historyList.innerHTML = '';
        if (snapshot.empty) {
            historyList.innerHTML = '<p class="no-history">You have no withdrawal history yet.</p>';
            return;
        }
        snapshot.forEach(doc => {
            const w = doc.data();
            const date = w.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const item = document.createElement('div');
            item.className = `history-item ${w.status}`; // 'pending' or 'completed'
            item.innerHTML = `
                <div class="history-details">
                    <p class="history-amount">${w.amount.toLocaleString()} PEPE</p>
                    <p class="history-date">${date}</p>
                </div>
                <div class="history-status ${w.status}">${w.status.charAt(0).toUpperCase() + w.status.slice(1)}</div>
            `;
            historyList.appendChild(item);
        });
    }

    // --- EVENT LISTENERS & HANDLERS ---
    
    // Tab Navigation
    document.querySelector('.nav-bar').addEventListener('click', (e) => {
        const navItem = e.target.closest('.nav-item');
        if (!navItem) return;
        
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        navItem.classList.add('active');
        
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        document.getElementById(navItem.dataset.tab).classList.add('active');
    });

    // Bonus Task Logic
    const channelTaskCard = document.getElementById('task-channel-join');
    const joinBtn = channelTaskCard.querySelector('.join-btn');
    const verifyBtn = channelTaskCard.querySelector('.verify-btn');
    
    joinBtn.addEventListener('click', () => {
        window.open(channelTaskCard.dataset.url, '_blank');
        verifyBtn.disabled = false;
    });

    verifyBtn.addEventListener('click', async () => {
        const userRef = db.collection('users').doc(String(currentUser.id));
        const doc = await userRef.get();
        if (doc.data().completedTasks.includes('channel_1')) return;

        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(Number(channelTaskCard.dataset.reward)),
            completedTasks: firebase.firestore.FieldValue.arrayUnion('channel_1')
        });
        tg.showPopup({ title: 'Success!', message: `+${channelTaskCard.dataset.reward} PEPE has been added to your balance.` });
        verifyBtn.disabled = true;
    });

    // Earn Tab Logic
    document.getElementById('start-task-button').addEventListener('click', async () => {
        const watchAdBtn = document.getElementById('start-task-button');
        watchAdBtn.disabled = true;
        tg.HapticFeedback.impactOccurred('light');

        setTimeout(async () => {
            const userRef = db.collection('users').doc(String(currentUser.id));
            try {
                await db.runTransaction(async (transaction) => {
                    const userDoc = await transaction.get(userRef);
                    if (!userDoc.exists) throw "User not found!";
                    const userData = userDoc.data();
                    if (userData.adsWatchedToday >= DAILY_AD_LIMIT) throw "Daily ad limit reached.";
                    
                    transaction.update(userRef, {
                        balance: firebase.firestore.FieldValue.increment(AD_REWARD),
                        adsWatchedToday: firebase.firestore.FieldValue.increment(1),
                        totalAdsEver: firebase.firestore.FieldValue.increment(1)
                    });
                    
                    if (userData.referrer) {
                        const referrerRef = db.collection('users').doc(userData.referrer);
                        const commission = AD_REWARD * 0.10;
                        transaction.update(referrerRef, {
                            balance: firebase.firestore.FieldValue.increment(commission),
                            referralEarnings: firebase.firestore.FieldValue.increment(commission)
                        });
                    }
                });
                tg.HapticFeedback.notificationOccurred('success');
            } catch (e) {
                tg.showPopup({ title: 'Error', message: String(e) });
                tg.HapticFeedback.notificationOccurred('error');
            }
        }, 2000);
    });

    // Withdrawal Logic
    document.getElementById('submit-withdrawal-button').addEventListener('click', async () => {
        const amount = parseInt(document.getElementById('withdraw-amount').value);
        const address = document.getElementById('wallet-id').value.trim();
        const MIN_WITHDRAW = 10000;

        if (!amount || !address) {
            return tg.showPopup({ title: 'Error', message: 'Please fill in all withdrawal fields.' });
        }
        if (amount < MIN_WITHDRAW) {
            return tg.showPopup({ title: 'Error', message: `Minimum withdrawal is ${MIN_WITHDRAW.toLocaleString()} PEPE.` });
        }

        const userRef = db.collection('users').doc(String(currentUser.id));
        try {
            await db.runTransaction(async (transaction) => {
                const userDoc = await transaction.get(userRef);
                if (!userDoc.exists) throw new Error("User not found.");
                if (userDoc.data().balance < amount) throw new Error("Insufficient balance.");
                
                transaction.update(userRef, { 
                    balance: firebase.firestore.FieldValue.increment(-amount),
                    withdrawalTotal: firebase.firestore.FieldValue.increment(amount) 
                });

                const withdrawalRef = db.collection('withdrawals').doc();
                transaction.set(withdrawalRef, {
                    userId: currentUser.id,
                    username: currentUser.username,
                    amount: amount,
                    address: address,
                    status: 'pending',
                    createdAt: firebase.firestore.Timestamp.now()
                });
            });
            tg.showPopup({ title: 'Success!', message: 'Your withdrawal request is pending.' });
            document.getElementById('withdraw-amount').value = '';
            document.getElementById('wallet-id').value = '';
        } catch (e) {
            tg.showPopup({ title: 'Error', message: e.message });
        }
    });

    // Modal and Copy Logic
    const referModal = document.getElementById('refer-modal');
    document.getElementById('refer-fab').addEventListener('click', () => referModal.style.display = 'flex');
    document.getElementById('close-modal-btn').addEventListener('click', () => referModal.style.display = 'none');
    
    function copyToClipboard(text, button) {
        navigator.clipboard.writeText(text).then(() => {
            tg.HapticFeedback.notificationOccurred('success');
            const originalIcon = button.innerHTML;
            button.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => { button.innerHTML = originalIcon; }, 1500);
        });
    }

    document.getElementById('copy-profile-link-btn').addEventListener('click', (e) => {
        copyToClipboard(document.getElementById('profile-referral-link').value, e.currentTarget);
    });
    document.getElementById('copy-modal-link-btn').addEventListener('click', (e) => {
        copyToClipboard(document.getElementById('referral-link-modal').value, e.currentTarget);
    });
});
