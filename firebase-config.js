// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBi24iOZYrjyiDx34tEGfXKV91-pS_hdIw",
    authDomain: "zmeet-a2134.firebaseapp.com",
    projectId: "zmeet-a2134",
    storageBucket: "zmeet-a2134.firebasestorage.app",
    messagingSenderId: "394508254669",
    appId: "1:394508254669:web:ec7b634eac9e1abf489884",
    measurementId: "G-ZYHSF3PBG9"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();