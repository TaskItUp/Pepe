document.addEventListener('DOMContentLoaded', () => {
    // --- [DATABASE & APP INITIALIZATION] ---
    const firebaseConfig = {
        apiKey: "AIzaSyB1TYSc2keBepN_cMV9oaoHFRdcJaAqG_g",
        authDomain: "taskup-9ba7b.firebaseapp.com",
        projectId: "taskup-9ba7b",
        storageBucket: "taskup-9ba7b.appspot.com",
        messagingSenderId: "319481101196",
        appId: "1:319481101196:web:6cded5be97620d98d974a9",
        measurementId: "G-JNNLG1E49L"
    };

    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();

    // --- [GLOBAL STATE & CONSTANTS] ---
    let userState = {};
    let telegramUserId = null;
    const TELEGRAM_BOT_USERNAME = "TaskItUpBot";
    const DAILY_TASK_LIMIT = 40;
    const AD_REWARD = 250;
    const REFERRAL_COMMISSION_RATE = 0.10;
    const WITHDRAWAL_MINIMUMS = { binancepay: 10000 };

    // --- [ROBUST APP INITIALIZATION] ---
    async function main() {
        const loadingOverlay = document.getElementById('loading-overlay');
        const appContainer = document.getElementById('app-container');

        if (!window.Telegram || !window.Telegram.WebApp || !window.Telegram.WebApp.initDataUnsafe.user) {
            loadingOverlay.innerHTML = `<p class="error-page">Cannot authenticate user. Please open this app inside Telegram.</p>`;
            return;
        }

        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();

        const tgUser = tg.initDataUnsafe.user;
        telegramUserId = tgUser.id.toString();

        const userRef = db.collection('users').doc(telegramUserId);

        try {
            // STEP 1: Perform a one-time, guaranteed check for the user.
            const doc = await userRef.get();

            // STEP 2: If the user does NOT exist, create their profile immediately.
            if (!doc.exists) {
                const referrerId = tg.initDataUnsafe.start_param || null;
                const newUserState = {
                    username: `${tgUser.first_name} ${tgUser.last_name || ''}`.trim(),
                    telegramUsername: `@${tgUser.username || tgUser.id}`,
                    profilePicUrl: generatePlaceholderAvatar(telegramUserId),
                    balance: 0,
                    tasksCompletedToday: 0,
                    lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    totalEarned: 0,
                    totalAdsViewed: 0,
                    totalRefers: 0,
                    joinedBonusTasks: [],
                    referredBy: referrerId && referrerId !== telegramUserId ? referrerId : null,
                    referralEarnings: 0
                };
                
                await userRef.set(newUserState);

                if (newUserState.referredBy) {
                    const referrerRef = db.collection('users').doc(newUserState.referredBy);
                    await referrerRef.update({ totalRefers: firebase.firestore.FieldValue.increment(1) });
                }
            }

            // STEP 3: Now that the user is guaranteed to exist, attach real-time listeners.
            userRef.onSnapshot(handleUserUpdate);
            listenForWithdrawalHistory();
            setupTaskButtonListeners();

            // Show the app
            loadingOverlay.classList.remove('active');
            appContainer.style.display = 'block';

        } catch (error) {
            console.error("Critical Initialization Error:", error);
            loadingOverlay.innerHTML = `<p class="error-page">Could not connect to the database. Please check your internet connection or try again later.</p>`;
        }
    }

    function handleUserUpdate(doc) {
        if (!doc.exists) return;
        userState = doc.data();
        updateUI();
    }
    
    // --- [UI UPDATE] ---
    function updateUI() {
        if (!userState) return;

        // Reset tasks if a new day has started
        if (userState.lastTaskTimestamp) {
            const lastTaskDate = userState.lastTaskTimestamp.toDate();
            const today = new Date();
            if (lastTaskDate.getDate() !== today.getDate() || lastTaskDate.getMonth() !== today.getMonth() || lastTaskDate.getFullYear() !== today.getFullYear()) {
                if (userState.tasksCompletedToday > 0) {
                     db.collection('users').doc(telegramUserId).update({ tasksCompletedToday: 0 });
                }
            }
        }

        const balanceString = Math.floor(userState.balance || 0).toLocaleString();
        const totalEarnedString = Math.floor(userState.totalEarned || 0).toLocaleString();
        const referralEarningsString = (userState.referralEarnings || 0).toLocaleString();
        const totalRefersString = (userState.totalRefers || 0).toLocaleString();

        document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => {
            if (userState.profilePicUrl) img.src = userState.profilePicUrl;
        });

        document.getElementById('balance-home').textContent = balanceString;
        document.getElementById('withdraw-balance').textContent = balanceString;
        document.getElementById('profile-balance').textContent = balanceString;
        document.getElementById('home-username').textContent = userState.username;
        document.getElementById('profile-name').textContent = userState.username;
        document.getElementById('telegram-username').textContent = userState.telegramUsername;
        
        const tasksCompleted = userState.tasksCompletedToday || 0;
        document.getElementById('ads-watched-today').textContent = tasksCompleted;
        document.getElementById('ads-left-today').textContent = DAILY_TASK_LIMIT - tasksCompleted;
        document.getElementById('tasks-completed').textContent = `${tasksCompleted} / ${DAILY_TASK_LIMIT}`;
        document.getElementById('task-progress-bar').style.width = `${(tasksCompleted / DAILY_TASK_LIMIT) * 100}%`;
        
        const taskButton = document.getElementById('start-task-button');
        taskButton.disabled = tasksCompleted >= DAILY_TASK_LIMIT;
        taskButton.innerHTML = tasksCompleted >= DAILY_TASK_LIMIT ? '<i class="fas fa-check-circle"></i> All tasks done' : '<i class="fas fa-play-circle"></i> Watch Ad';
        
        document.getElementById('earned-so-far').textContent = totalEarnedString;
        document.getElementById('total-ads-viewed').textContent = userState.totalAdsViewed || 0;
        document.getElementById('total-refers').textContent = totalRefersString;
        document.getElementById('refer-earnings').textContent = referralEarningsString;
        document.getElementById('refer-count').textContent = totalRefersString;

        const joinedTasks = userState.joinedBonusTasks || [];
        joinedTasks.forEach(taskId => {
            const taskCard = document.getElementById(`task-${taskId}`);
            if (taskCard) taskCard.classList.add('completed');
        });

        const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
        const modalLinkInput = document.getElementById('referral-link');
        if (modalLinkInput) modalLinkInput.value = referralLink;
        const profileLinkInput = document.getElementById('profile-referral-link');
        if (profileLinkInput) profileLinkInput.value = referralLink;
    }

    // --- [EVENT HANDLERS & LOGIC] ---
    // The rest of the functions are taken directly from the script you provided,
    // as they correctly handle the UI actions.

    async function payReferralCommission(earnedAmount) {
        if (!userState.referredBy) return;
        const commissionAmount = Math.floor(earnedAmount * REFERRAL_COMMISSION_RATE);
        if (commissionAmount <= 0) return;
        const referrerRef = db.collection('users').doc(userState.referredBy);
        return referrerRef.update({
            balance: firebase.firestore.FieldValue.increment(commissionAmount),
            referralEarnings: firebase.firestore.FieldValue.increment(commissionAmount)
        }).catch(error => console.error("Failed to pay commission:", error));
    }

    function setupTaskButtonListeners() {
        document.querySelectorAll('.task-card').forEach(card => {
            const joinBtn = card.querySelector('.join-btn');
            const verifyBtn = card.querySelector('.verify-btn');
            const taskId = card.dataset.taskId;
            const url = card.dataset.url;
            const reward = parseInt(card.dataset.reward);
            if (joinBtn) joinBtn.addEventListener('click', () => handleJoinClick(taskId, url));
            if (verifyBtn) verifyBtn.addEventListener('click', () => handleVerifyClick(taskId, reward));
        });
    }

    async function handleVerifyClick(taskId, reward) {
        if (!userState.joinedBonusTasks) userState.joinedBonusTasks = [];
        if (userState.joinedBonusTasks.includes(taskId)) {
            alert("You have already completed this task.");
            return;
        }
        const taskCard = document.getElementById(`task-${taskId}`);
        const verifyButton = taskCard ? taskCard.querySelector('.verify-btn') : null;
        if (verifyButton) {
            verifyButton.disabled = true;
            verifyButton.textContent = "Verifying...";
        }
        try {
            const userRef = db.collection('users').doc(telegramUserId);
            await userRef.update({
                balance: firebase.firestore.FieldValue.increment(reward),
                totalEarned: firebase.firestore.FieldValue.increment(reward),
                joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId)
            });
            await payReferralCommission(reward);
            alert(`Verification successful! You've earned ${reward} PEPE.`);
        } catch (error) {
            console.error("Error rewarding user for channel join:", error);
            alert("An error occurred. Please try again.");
            if (verifyButton) {
                verifyButton.disabled = false;
                verifyButton.textContent = "Verify";
            }
        }
    }

    function handleJoinClick(taskId, url) {
        const taskCard = document.getElementById(`task-${taskId}`);
        if (!taskCard) return;
        const verifyButton = taskCard.querySelector('.verify-btn');
        window.open(url, '_blank');
        if (verifyButton) verifyButton.disabled = false;
    }

    window.completeAdTask = async function () {
        if (!userState || (userState.tasksCompletedToday || 0) >= DAILY_TASK_LIMIT) {
            alert("You have completed all ad tasks for today!");
            return;
        }
        const taskButton = document.getElementById('start-task-button');
        try {
            taskButton.disabled = true;
            taskButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';
            if (typeof window.show_9685198 === 'function') {
                await window.show_9685198();
            } else {
                await new Promise(res => setTimeout(res, 800));
            }
            const userRef = db.collection('users').doc(telegramUserId);
            await userRef.update({
                balance: firebase.firestore.FieldValue.increment(AD_REWARD),
                totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
                tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
                totalAdsViewed: firebase.firestore.FieldValue.increment(1),
                lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            await payReferralCommission(AD_REWARD);
            alert(`Success! ${AD_REWARD} PEPE has been added to your balance.`);
        } catch (error) {
            console.error("An error occurred during the ad task:", error);
            alert("Ad could not be shown or was closed early. Please try again.");
        }
    };

    window.submitWithdrawal = async function () {
        const amount = parseInt(document.getElementById('withdraw-amount').value);
        const method = document.getElementById('withdraw-method').value;
        const walletId = document.getElementById('wallet-id').value.trim();
        const minAmount = WITHDRAWAL_MINIMUMS[method];
        if (isNaN(amount) || amount <= 0 || !walletId) return alert('Please enter a valid amount and your Binance ID or Email.');
        if (amount < minAmount) return alert(`Withdrawal failed. Minimum is ${minAmount.toLocaleString()} PEPE.`);
        if (amount > userState.balance) return alert('Withdrawal failed. Not enough balance.');
        try {
            await db.collection('withdrawals').add({
                userId: telegramUserId,
                username: userState.telegramUsername,
                amount: amount,
                method: "Binance Pay",
                walletId: walletId,
                currency: "PEPE",
                status: "pending",
                requestedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await db.collection('users').doc(telegramUserId).update({
                balance: firebase.firestore.FieldValue.increment(-amount)
            });
            alert(`Success! Withdrawal request for ${amount.toLocaleString()} PEPE submitted.`);
            document.getElementById('withdraw-amount').value = '';
            document.getElementById('wallet-id').value = '';
        } catch (error) {
            console.error("Withdrawal failed:", error);
            alert("There was an error submitting your request. Please try again.");
        }
    };

    function renderHistoryItem(withdrawalData) {
        const item = document.createElement('div');
        item.className = `history-item ${withdrawalData.status}`;
        const date = withdrawalData.requestedAt.toDate ? withdrawalData.requestedAt.toDate() : new Date();
        const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        item.innerHTML = `<div class="history-details"><div class="history-amount">${withdrawalData.amount.toLocaleString()} PEPE</div><div class="history-date">${formattedDate}</div></div><div class="history-status ${withdrawalData.status}">${withdrawalData.status}</div>`;
        return item;
    }

    function listenForWithdrawalHistory() {
        const historyList = document.getElementById('history-list');
        db.collection('withdrawals').where('userId', '==', telegramUserId).orderBy('requestedAt', 'desc').limit(10)
            .onSnapshot(querySnapshot => {
                if (querySnapshot.empty) {
                    historyList.innerHTML = '<p class="no-history">You have no withdrawal history yet.</p>';
                    return;
                }
                historyList.innerHTML = '';
                querySnapshot.forEach(doc => {
                    historyList.appendChild(renderHistoryItem(doc.data()));
                });
            });
    }

    window.openReferModal = function () {
        const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
        const input = document.getElementById('referral-link');
        if (input) input.value = referralLink;
        document.getElementById('refer-modal').style.display = 'flex';
    };
    window.closeReferModal = function () { document.getElementById('refer-modal').style.display = 'none'; };
    window.copyReferralLink = function (button, inputId = 'referral-link') {
        const linkInput = document.getElementById(inputId);
        if (!linkInput) return;
        navigator.clipboard.writeText(linkInput.value).then(() => {
            const originalIcon = button.innerHTML;
            button.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => { button.innerHTML = originalIcon; }, 1500);
        });
    };
    window.onclick = function (event) { if (event.target == document.getElementById('refer-modal')) { closeReferModal(); } };
    window.showTab = function (tabName, element) {
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(tabName).classList.add('active');
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        if (element) element.classList.add('active');
    };
    function generatePlaceholderAvatar(userId) { return `https://i.pravatar.cc/150?u=${userId}`; }

    // --- [APP ENTRY POINT] ---
    main();
});
