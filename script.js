<!-- Firebase SDK -->
<script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js"></script> <!-- ADD THIS -->

<!-- Telegram WebApp -->
<script src="https://telegram.org/js/telegram-web-app.js"></script>

<script>
document.addEventListener("DOMContentLoaded", () => {
    initTelegramApp();
});

// --- FIREBASE CONFIG ---
const firebaseConfig = {
    // Your config remains here
    apiKey: "AIzaSyB1TYSc2keBepN_cMV9oaoHFRdcJaAqG_g",
    authDomain: "taskup-9ba7b.firebaseapp.com",
    projectId: "taskup-9ba7b",
    storageBucket: "taskup-9ba7b.appspot.com",
    messagingSenderId: "319481101196",
    appId: "1:319481101196:web:6cded5be97620d98d974a9",
    measurementId: "G-JNNLG1E49L"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const functions = firebase.functions(); // Initialize Firebase Functions

// --- GLOBAL VARIABLES ---
let userState = {};
let telegramUserId = null;
let isInitialized = false;
const DAILY_TASK_LIMIT = 40; // This can now be a reference, but enforcement happens on the server

// --- INIT TELEGRAM APP & INITIALIZE APP ---
function initTelegramApp() {
    if (window.Telegram && Telegram.WebApp) {
        Telegram.WebApp.ready();

        // VALIDATE THIS DATA ON THE BACKEND. For the client, we proceed optimistically.
        const tgUser = Telegram.WebApp.initDataUnsafe?.user || null;
        const startParam = Telegram.WebApp.initDataUnsafe?.start_param || null;

        if (!tgUser) {
            console.warn("Running in test mode or no Telegram user found");
            initializeAppForTesting();
            return;
        }

        telegramUserId = tgUser.id.toString();
        console.log(`Initializing for User ID: ${telegramUserId}`);

        const userRef = db.collection('users').doc(telegramUserId);

        userRef.onSnapshot((doc) => {
            if (!doc.exists) {
                // User doesn't exist. We let the server-side function create them.
                // This prevents race conditions and securely handles referrals.
                console.log("New user detected. Server will create the user document on first action.");
            } else {
                userState = doc.data();
            }

            if (!isInitialized) {
                setupTaskButtonListeners();
                isInitialized = true;
            }
            updateUI();
        }, (error) => {
            console.error("Snapshot error:", error);
        });

    } else {
       initializeAppForTesting();
    }
}

// --- All logic for creating users is now on the server ---

// --- HELPERS ---
function initializeAppForTesting() {
    console.warn("Running in test mode (no Telegram detected)");
    // minimal setup for testing UI without a real user
    telegramUserId = 'test_user_123';
    userState = {
        balance: 0,
        tasksCompletedToday: 0,
        profilePicUrl: `https://i.pravatar.cc/150?u=test_user`
    };
    setupTaskButtonListeners();
    isInitialized = true;
    updateUI();
}


// --- UI UPDATE (Mostly Unchanged) ---
function updateUI() {
    if (!document.getElementById('balance-home')) return;

    const profilePic = userState.profilePicUrl || `https://i.pravatar.cc/150?u=${telegramUserId}`;
    document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => {
        img.src = profilePic;
    });

    const tasksCompleted = userState.tasksCompletedToday || 0;
    const balance = Math.floor(userState.balance || 0).toLocaleString();

    document.getElementById('balance-home').textContent = balance;
    document.getElementById('tasks-completed').textContent = `${tasksCompleted} / ${DAILY_TASK_LIMIT}`;
    document.getElementById('ads-left-today').textContent = DAILY_TASK_LIMIT - tasksCompleted;

    document.getElementById('task-progress-bar').style.width = `${(tasksCompleted / DAILY_TASK_LIMIT) * 100}%`;

    const taskButton = document.getElementById('start-task-button');
    taskButton.disabled = tasksCompleted >= DAILY_TASK_LIMIT;
    taskButton.innerHTML = tasksCompleted >= DAILY_TASK_LIMIT
        ? '<i class="fas fa-check-circle"></i> All tasks done'
        : '<i class="fas fa-play-circle"></i> Watch Ad';
}

// --- BUTTON LISTENERS ---
function setupTaskButtonListeners() {
    const taskBtn = document.getElementById('start-task-button');
    if (!taskBtn) return;

    taskBtn.addEventListener('click', () => {
        // Disable button to prevent double-clicking
        taskBtn.disabled = true;
        taskBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

        console.log("Calling secure cloud function to credit user...");

        // Get the entire initData string to send for server-side validation
        const initData = Telegram.WebApp.initData || null;
        const startParam = Telegram.WebApp.initDataUnsafe?.start_param || null;
        const urlRefId = new URLSearchParams(window.location.search).get('ref');
        const referrerId = startParam || urlRefId || null;


        // Use the 'functions' service to call your Cloud Function
        const completeTask = functions.httpsCallable('completeTask');
        completeTask({ initData: initData, referrerId: referrerId })
            .then((result) => {
                console.log("Cloud function executed successfully:", result.data);
                // The UI will update automatically via the onSnapshot listener.
                // We just re-enable the button if they still have tasks left.
            })
            .catch((error) => {
                console.error("Error calling cloud function:", error);
                // Inform the user of the error
                alert(`Error: ${error.message}`);
                // Re-enable the button so they can try again
                taskBtn.disabled = false;
                updateUI(); // Reset button text
            });
    });
}
</script>
