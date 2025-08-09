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

    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    const tg = window.Telegram.WebApp;

    // --- Basic App Setup ---
    tg.expand();
    tg.ready();

    // --- User Data ---
    let currentUser = null;

    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        currentUser = tg.initDataUnsafe.user;
        initializeUser(currentUser);
    } else {
        document.body.innerHTML = '<div style="text-align: center; padding-top: 50px; font-family: Poppins, sans-serif;">Please open this app within Telegram.</div>';
    }

    // --- UI Elements ---
    const balanceElement = document.getElementById('balance');
    const withdrawBalanceElement = document.getElementById('withdraw-balance');
    const welcomeMessage = document.getElementById('welcome-message');
    const adProgress = document.getElementById('ad-progress');
    const progressBar = document.getElementById('progress-bar');
    const watchAdBtn = document.getElementById('watch-ad-btn');
    const historyList = document.getElementById('history-list');
    const profilePic = document.getElementById('profile-pic');
    const profileName = document.getElementById('profile-name');
    const profileUsername = document.getElementById('profile-username');
    const referralLinkInput = document.getElementById('referral-link-input');
    const totalEarned = document.getElementById('total-earned');
    const totalAdsWatched = document.getElementById('total-ads-watched');
    const totalReferrals = document.getElementById('total-referrals');
    const totalReferralEarnings = document.getElementById('total-referral-earnings');


    async function initializeUser(user) {
        welcomeMessage.textContent = `Welcome, ${user.first_name}!`;
        profileName.textContent = `${user.first_name} ${user.last_name || ''}`;
        profileUsername.textContent = `@${user.username}`;
        
        const userRef = db.collection('users').doc(String(user.id));
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            const referrerId = tg.initDataUnsafe.start_param;
            await userRef.set({
                id: user.id,
                username: user.username,
                firstName: user.first_name,
                balance: 0,
                adsWatchedToday: 0,
                totalAdsEver: 0,
                lastAdReset: firebase.firestore.Timestamp.now(),
                joinedChannel: false,
                referrals: 0,
                referralEarnings: 0,
                withdrawalTotal: 0,
                referrer: referrerId || null,
                createdAt: firebase.firestore.Timestamp.now()
            });
            if (referrerId) {
                const referrerRef = db.collection('users').doc(referrerId);
                referrerRef.update({ referrals: firebase.firestore.FieldValue.increment(1) }).catch(console.error);
            }
        }
        
        userRef.onSnapshot(doc => {
            if (doc.exists) {
                updateUI(doc.data());
            }
        });
        
        db.collection('withdrawals').where("userId", "==", user.id).orderBy("createdAt", "desc")
          .onSnapshot(snapshot => {
              historyList.innerHTML = '';
              if (snapshot.empty) {
                  historyList.innerHTML = '<li>No withdrawal history.</li>';
                  return;
              }
              snapshot.forEach(doc => {
                  const w = doc.data();
                  const listItem = document.createElement('li');
                  listItem.innerHTML = `<span>${w.amount} Pepe</span><span class="${w.status}">${w.status.charAt(0).toUpperCase() + w.status.slice(1)}</span>`;
                  historyList.appendChild(listItem);
              });
          });

        const referralLink = `https://t.me/TaskItUpBot?start=${user.id}`;
        referralLinkInput.value = referralLink;
        document.getElementById('popup-referral-link').value = referralLink;
    }

    function updateUI(userData) {
        balanceElement.textContent = `${userData.balance.toLocaleString()} Pepe`;
        withdrawBalanceElement.textContent = `${userData.balance.toLocaleString()} Pepe`;
        
        const now = new Date();
        const lastReset = userData.lastAdReset.toDate();
        const hoursDiff = (now - lastReset) / 3600000;

        let adsToday = userData.adsWatchedToday;
        if (hoursDiff >= 24) {
            adsToday = 0;
            db.collection('users').doc(String(currentUser.id)).update({ adsWatchedToday: 0, lastAdReset: firebase.firestore.Timestamp.now() });
        }
        
        adProgress.textContent = `${adsToday}/40`;
        progressBar.style.width = `${(adsToday / 40) * 100}%`;
        watchAdBtn.disabled = adsToday >= 40;
        if(watchAdBtn.disabled) { watchAdBtn.textContent = 'Limit Reached'; } else { watchAdBtn.textContent = 'Watch Ad 👀'; }

        const totalLifetimeEarnings = (userData.balance + userData.withdrawalTotal).toFixed(0);
        totalEarned.textContent = `${parseInt(totalLifetimeEarnings).toLocaleString()} Pepe`;
        totalAdsWatched.textContent = userData.totalAdsEver || 0;
        totalReferrals.textContent = userData.referrals || 0;
        totalReferralEarnings.textContent = `${(userData.referralEarnings || 0).toLocaleString()} Pepe`;
    }

    const navButtons = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    navButtons.forEach((button, index) => {
        button.innerHTML = button.textContent; // Use emoji as content
        button.addEventListener('click', () => {
            navButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(button.dataset.tab).classList.add('active');
        });
    });

    document.getElementById('verify-join-btn').addEventListener('click', async () => {
        const userRef = db.collection('users').doc(String(currentUser.id));
        const userDoc = await userRef.get();
        if (!userDoc.data().joinedChannel) {
            await userRef.update({
                balance: firebase.firestore.FieldValue.increment(300),
                joinedChannel: true
            });
            tg.showPopup({title: 'Success!', message: 'Verified! 300 Pepe has been added to your balance.'});
        } else {
            tg.showPopup({title: 'Oops!', message: 'You have already claimed this bonus.'});
        }
    });

    watchAdBtn.addEventListener('click', () => {
        watchAdBtn.disabled = true;
        tg.HapticFeedback.impactOccurred('light');

        setTimeout(async () => {
            const userRef = db.collection('users').doc(String(currentUser.id));
            try {
                await db.runTransaction(async (transaction) => {
                    const userDoc = await transaction.get(userRef);
                    if (!userDoc.exists) throw "User not found!";
                    const userData = userDoc.data();
                    
                    const now = new Date();
                    const lastReset = userData.lastAdReset.toDate();
                    if ((now - lastReset) / 3600000 >= 24) {
                       transaction.update(userRef, { adsWatchedToday: 0, lastAdReset: firebase.firestore.Timestamp.now() });
                    }
                    
                    if (userDoc.data().adsWatchedToday < 40) {
                        transaction.update(userRef, {
                            balance: firebase.firestore.FieldValue.increment(250),
                            adsWatchedToday: firebase.firestore.FieldValue.increment(1),
                            totalAdsEver: firebase.firestore.FieldValue.increment(1)
                        });

                        if (userData.referrer) {
                            const referrerRef = db.collection('users').doc(userData.referrer);
                            const commission = 250 * 0.10;
                            transaction.update(referrerRef, {
                                balance: firebase.firestore.FieldValue.increment(commission),
                                referralEarnings: firebase.firestore.FieldValue.increment(commission)
                            });
                        }
                    } else {
                        throw "Ad limit reached for today.";
                    }
                });
                tg.HapticFeedback.notificationOccurred('success');
            } catch (e) {
                tg.showPopup({title: 'Error', message: String(e)});
                tg.HapticFeedback.notificationOccurred('error');
            }
        }, 2000); 
    });

    document.getElementById('withdraw-btn').addEventListener('click', async () => {
        const amount = parseInt(document.getElementById('withdraw-amount').value);
        const address = document.getElementById('withdraw-address').value.trim();

        if (!amount || !address) {
            tg.showPopup({title: 'Error', message: 'Please fill in all withdrawal fields.'}); return;
        }
        if (amount < 10000) {
            tg.showPopup({title: 'Error', message: 'Minimum withdrawal is 10,000 Pepe.'}); return;
        }

        const userRef = db.collection('users').doc(String(currentUser.id));
        try {
            await db.runTransaction(async (transaction) => {
                const userDoc = await transaction.get(userRef);
                if (!userDoc.exists) throw new Error("User not found");
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
            tg.showPopup({title: 'Success!', message: 'Your withdrawal request is pending.'});
            document.getElementById('withdraw-amount').value = '';
            document.getElementById('withdraw-address').value = '';
        } catch(e) {
            tg.showPopup({title: 'Error', message: `An error occurred: ${e.message}`});
        }
    });

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            tg.HapticFeedback.notificationOccurred('success');
            tg.showPopup({message: 'Link copied to clipboard!'});
        });
    }

    document.getElementById('copy-referral-btn').addEventListener('click', () => copyToClipboard(referralLinkInput.value));
    document.getElementById('popup-copy-btn').addEventListener('click', () => copyToClipboard(document.getElementById('popup-referral-link').value));

    const giftBox = document.getElementById('gift-box-icon');
    const referralPopup = document.getElementById('referral-popup');
    const closePopup = document.querySelector('.close-popup');

    giftBox.addEventListener('click', () => referralPopup.style.display = 'flex');
    closePopup.addEventListener('click', () => referralPopup.style.display = 'none');
});
