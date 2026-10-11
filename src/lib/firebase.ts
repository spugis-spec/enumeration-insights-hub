import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence, type Auth } from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";

// Existing AEDC GIS Firebase project (public web config — safe in client code).
export const firebaseConfig = {
  apiKey: "AIzaSyA_Ql8LLNx4jf8o6H89u9iwSAmeZflj-hs",
  authDomain: "spugis.firebaseapp.com",
  databaseURL: "https://spugis-default-rtdb.firebaseio.com",
  projectId: "spugis",
  storageBucket: "spugis.firebasestorage.app",
  messagingSenderId: "295940607308",
  appId: "1:295940607308:web:5ad07c96ab8ede791d13e9",
  measurementId: "G-M1TBHGMV5V",
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;

export function getFirebaseApp() {
  if (!app) app = getApps()[0] ?? initializeApp(firebaseConfig);
  return app;
}
export function getFirebaseAuth() {
  if (!auth) {
    auth = getAuth(getFirebaseApp());
    void setPersistence(auth, browserLocalPersistence);
  }
  return auth;
}
export function getDb(): Database {
  return getDatabase(getFirebaseApp());
}
