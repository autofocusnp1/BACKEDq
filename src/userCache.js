
import { db } from './firebase.js';
import { cachedKeyedLoader, TTL } from './cache.js';
import { bumpUser, bumpAllUsers } from './versions.js';

const users = cachedKeyedLoader(async (uid) => {
  const snap = await db().collection('users').doc(uid).get();
  return { exists: snap.exists, data: snap.exists ? snap.data() : null, at: Date.now() };
}, { ttlMs: TTL.userDoc, name: 'userDoc' });

export function getUserDoc(uid) {
  return users.get(uid);
}


export function invalidateUserDoc(uid) {
  users.invalidate(uid);
  bumpUser(uid);
}


export function invalidateAllUserDocs() {
  users.invalidateAll();
  bumpAllUsers();
}
