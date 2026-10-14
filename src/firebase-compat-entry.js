import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

// The legacy portal expects Firebase's compat global before its inline scripts run.
window.firebase = firebase;
