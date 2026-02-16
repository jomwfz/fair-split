// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ⚠️ ตรงนี้สำคัญ! ไปก๊อปปี้ firebaseConfig จากหน้าเว็บ Firebase Console ของคุณมาใส่แทนที่ตรงนี้นะครับ
// (ค่าที่คุณเคยทำไว้ตอน Phase 3)
const firebaseConfig = {
  apiKey: "AIzaSyCnmn9iT6HqSl1tmFrCkYxi8f0R2IBk8V8",
  authDomain: "fair-split-app-c6b72.firebaseapp.com",
  projectId: "fair-split-app-c6b72",
  storageBucket: "fair-split-app-c6b72.firebasestorage.app",
  messagingSenderId: "273822038005",
  appId: "1:273822038005:web:f80734be52e270507392bc",
  measurementId: "G-8LVDXKBLV0"
};

// เริ่มต้นระบบ Firebase
const app = initializeApp(firebaseConfig);

// ส่งออกตัวจัดการ (Auth & Database) ไปให้ไฟล์อื่นใช้
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);