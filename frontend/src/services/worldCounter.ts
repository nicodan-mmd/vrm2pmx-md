import { getApp, getApps, initializeApp } from "firebase/app";
import { ReCaptchaV3Provider, initializeAppCheck } from "firebase/app-check";
import { doc, getDoc, getFirestore, increment, serverTimestamp, setDoc } from "firebase/firestore";

declare global {
  interface Window {
    FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean;
  }
}

type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

function getFirebaseConfig(): FirebaseConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim();
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim();
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim();
  const appId = import.meta.env.VITE_FIREBASE_APP_ID?.trim();
  const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim();

  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId) {
    return null;
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    measurementId,
  };
}

function getFirestoreInstance() {
  const config = getFirebaseConfig();
  if (!config) {
    return null;
  }

  const isNew = getApps().length === 0;
  const app = isNew ? initializeApp(config) : getApp();

  if (isNew) {
    const debugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN?.trim();
    if (debugToken) {
      window.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken === "true" ? true : debugToken;
    }

    const siteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY?.trim();
    if (siteKey) {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    }
  }

  return getFirestore(app);
}

export async function incrementWorldCounterOnFirestore(): Promise<void> {
  const db = getFirestoreInstance();
  if (!db) {
    return;
  }

  const counterRef = doc(db, "counters", "world");
  await setDoc(
    counterRef,
    {
      count: increment(1),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function getWorldCounterFromFirestore(): Promise<number | null> {
  const db = getFirestoreInstance();
  if (!db) {
    return null;
  }

  const counterRef = doc(db, "counters", "world");
  const snapshot = await getDoc(counterRef);
  if (!snapshot.exists()) {
    return 0;
  }

  const count = snapshot.data()?.count;
  return typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}
