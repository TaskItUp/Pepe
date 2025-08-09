document.addEventListener('DOMContentLoaded', () => {
    // --- THIS IS THE CONNECTION TO YOUR FIREBASE DATABASE ---
    const firebaseConfig = {
        apiKey: "AIzaSyA_l71gxjNPxLZ-5oV40ap-8Cp_4MnH-Jg",
        authDomain: "taskitup-9de28.firebaseapp.com",
        projectId: "taskitup-9de28",
        storageBucket: "taskitup-9de28.appspot.com",
        messagingSenderId: "1030752202095",
        appId: "1:1030752202095:web:ac1b5a8ff85ba2c6204c9a"
    };

    // Initialize Firebase Connection
    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    const tg = window.Telegram.WebApp;

    tg.expand();
    tg.ready();
    
    // --- MAIN APP INITIALIZATION ---
    function main() {
        if (!tg.initDataUnsafe || !tg.initDataUnsafe.user) {
            document.body.innerHTML = '<div class="error-page">Please open this app inside Telegram.</div>';
            return;
        }
        
        const currentUser = tg.initDataUnsafe.user;
        const userRef = db.collection('users').doc(String(currentUser.id));

        // This is the core of the app. It listens for ANY changes to the user's data.
        // It runs once on initial load and then again every time the data changes in Firebase.
        userRef.onSnapshot(async (doc) => {
            if (!doc.exists) {
                // If the user is new, create their profile first.
                // The onSnapshot listener will then automatically re-run with the new data.
                const referrerId = tg.initDataUnsafe.start_param || null;
                await userRef.set({
                    id: currentUser.id,
                    username: currentUser.username || 'N/A',
                    firstName: currentUser.first_name,
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
                });

                if (referrerId) {
                    const referrerRef = db.collection('users').doc(referrerId);
                    await referrerRef.update({ referrals: firebase.firestore.FieldValue.increment(1) }).catch(console.error);
                }
            } else {
                // If the user exists, update the entire UI with their latest data.
                updateUI(doc.data());
            }
        }, (error) => {
            console.error("Firebase Snapshot Error: ", error);
            document.body.innerHTML = '<div class="error-page">Could not connect to the database. Please check your connection and Firebase Security Rules.</div>';
        });

        // Set up withdrawal history listener separately
        db.collection('withdrawals').where("userId", "==", currentUser.id).orderBy("createdAt", "desc").limit(10)
            .onSnapshot(updateWithdrawalHistory, (error) => {
                console.error("Withdrawal History Error: ", error);
            });
    }

    // --- UI UPDATE FUNCTIONS ---
    function updateUI(userData) {
        const { balance, adsWatchedToday, lastAdReset, completedTasks, totalAdsEver, referrals, referralEarnings, withdrawalTotal, firstName, username, id } = userData;

        let currentAdsWatched = adsWatchedToday;
        const now = new Date();
        if ((now - lastAdReset.toDate()) / 3600000 >= 24) {
            currentAdsWatched = 0;
            db.collection('users').doc(String(id)).update({ adsWatchedToday: 0, lastAdReset: firebase.firestore.Timestamp.now() });
        }
        
        const adsLeft = DAILY_AD_LIMIT - currentAdsWatched;
        const formattedBalance = Math.floor(balance).toLocaleString();

        document.getElementById('balance-home').textContent = formattedBalance;
        document.getElementById('withdraw-balance').textContent = formattedBalance;
        document.getElementById('profile-balance').textContent = formattedBalance;
        document.getElementById('home-username').textContent = firstName;
        document.getElementById('ads-watched-today').textContent = currentAdsWatched;
        document.getElementById('ads-left-today').textContent = adsLeft > 0 ? adsLeft : 0;
        
        const channelTaskCard = document.getElementById('task-channel-join');
        channelTaskCard.classList.toggle('completed', completedTasks && completedTasks.includes('channel_1'));

        document.getElementById('tasks-completed').textContent = currentAdsWatched;
        document.getElementById('task-progress-bar').style.width = `${(currentAdsWatched / DAILY_AD_LIMIT) * 100}%`;
        const watchAdBtn = document.getElementById('start-task-button');
        watchAdBtn.disabled = adsLeft <= 0;
        watchAdBtn.innerHTML = watchAdBtn.disabled ? '<i class="fas fa-stop-circle"></i> Daily Limit Reached' : '<i class="fas fa-play-circle"></i> Watch Ad';
        
        document.getElementById('profile-name').textContent = firstName;
        document.getElementById('telegram-username').textContent = `@${username}`;
        document.getElementById('earned-so-far').textContent = Math.floor(balance + withdrawalTotal).toLocaleString();
        document.getElementById('total-ads-viewed').textContent = totalAdsEver;
        document.getElementById('total-refers').textContent = referrals;

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
            item.className = `history-item ${w.status}`;
            item.innerHTML = `
                <div class="history-details">
                    <p class="history-amount">${w.amount.toLocaleString()} PEPE</p>
                    <p class="history-date">${date} - ${w.address}</p>
                </div>
                <div class="history-status ${w.status}">${w.status.charAt(0).toUpperCase() + w.status.slice(1)}</div>`;
            historyList.appendChild(item);
        });
    }

    // --- EVENT LISTENERS (No changes here, but kept for completeness) ---
    const AD_REWARD = 250;
    const DAILY_AD_LIMIT = 40;

    document.querySelector('.nav-bar').addEventListener('click', (e) => {
        const navItem = e.target.closest('.nav-item');
        if (!navItem) return;
        
        e.preventDefault();
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        navItem.classList.add('active');
        
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        document.getElementById(navItem.dataset.tab).classList.add('active');
    });

    const channelTaskCard = document.getElementById('task-channel-join');
    channelTaskCard.querySelector('.join-btn').addEventListener('click', () => {
        window.open(channelTaskCard.dataset.url, '_blank');
        channelTaskCard.querySelector('.verify-btn').disabled = false;
    });
    channelTaskCard.querySelector('.verify-btn').addEventListener('click', async (e) => {
        const userRef = db.collection('users').doc(String(tg.initDataUnsafe.user.id));
        e.target.disabled = true;
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(Number(channelTaskCard.dataset.reward)),
            completedTasks: firebase.firestore.FieldValue.arrayUnion('channel_1')
        });
        tg.showPopup({ title: 'Success!', message: `+${channelTaskCard.dataset.reward} PEPE has been added.` });
    });

    document.getElementById('start-task-button').addEventListener('click', () => {
        const watchAdBtn = document.getElementById('start-task-button');
        watchAdBtn.disabled = true;
        tg.HapticFeedback.impactOccurred('light');

        setTimeout(async () => {
            const userRef = db.collection('users').doc(String(tg.initDataUnsafe.user.id));
            try {
                await db.runTransaction(async (t) => {
                    const doc = await t.get(userRef);
                    if (!doc.exists) throw "User not found!";
                    const userData = doc.data();
                    
                    const now = new Date();
                    if ((now - userData.lastAdReset.toDate()) / 3600000 >= 24) {
                       if(userData.adsWatchedToday > 0) {
                           t.update(userRef, { adsWatchedToday: 0, lastAdReset: firebase.firestore.Timestamp.now() });
                       }
                    }
                    if (doc.data().adsWatchedToday >= DAILY_AD_LIMIT) throw "Daily ad limit reached.";
                    
                    t.update(userRef, {
                        balance: firebase.firestore.FieldValue.increment(AD_REWARD),
                        adsWatchedToday: firebase.firestore.FieldValue.increment(1),
                        totalAdsEver: firebase.firestore.FieldValue.increment(1)
                    });
                    
                    if (userData.referrer) {
                        const referrerRef = db.collection('users').doc(userData.referrer);
                        t.update(referrerRef, {
                            balance: firebase.firestore.FieldValue.increment(AD_REWARD * 0.10),
                            referralEarnings: firebase.firestore.FieldValue.increment(AD_REWARD * 0.10)
                        });
                    }
                });
                tg.HapticFeedback.notificationOccurred('success');
            } catch (err) {
                tg.showPopup({ title: 'Error', message: String(err) });
                tg.HapticFeedback.notificationOccurred('error');
            }
        }, 2000);
    });

    document.getElementById('submit-withdrawal-button').addEventListener('click', async () => {
        const amount = parseInt(document.getElementById('withdraw-amount').value);
        const address = document.getElementById('wallet-id').value.trim();
        const MIN_WITHDRAW = 10000;

        if (!amount || !address) return tg.showPopup({ title: 'Error', message: 'Please fill all fields.' });
        if (amount < MIN_WITHDRAW) return tg.showPopup({ title: 'Error', message: `Minimum withdrawal is ${MIN_WITHDRAW.toLocaleString()} PEPE.` });

        const userRef = db.collection('users').doc(String(tg.initDataUnsafe.user.id));
        try {
            await db.runTransaction(async (t) => {
                const doc = await t.get(userRef);
                if (!doc.exists) throw new Error("User not found.");
                if (doc.data().balance < amount) throw new Error("Insufficient balance.");
                
                t.update(userRef, { 
                    balance: firebase.firestore.FieldValue.increment(-amount),
                    withdrawalTotal: firebase.firestore.FieldValue.increment(amount) 
                });

                t.set(db.collection('withdrawals').doc(), {
                    userId: tg.initDataUnsafe.user.id, username: tg.initDataUnsafe.user.username, amount, address, status: 'pending', createdAt: firebase.firestore.Timestamp.now()
                });
            });
            tg.showPopup({ title: 'Success!', message: 'Withdrawal request submitted.' });
            document.getElementById('withdraw-amount').value = '';
            document.getElementById('wallet-id').value = '';
        } catch (e) {
            tg.showPopup({ title: 'Error', message: e.message });
        }
    });

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

    document.getElementById('copy-profile-link-btn').addEventListener('click', e => copyToClipboard(document.getElementById('profile-referral-link').value, e.currentTarget));
    document.getElementById('copy-modal-link-btn').addEventListener('click', e => copyToClipboard(document.getElementById('referral-link-modal').value, e.currentTarget));

    // --- START THE APP ---
    main();
});
